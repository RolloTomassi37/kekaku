package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/RolloTomassi37/kekaku/backend/internal/domain"
	_ "modernc.org/sqlite"
)

const schemaVersion = 2

type Store struct {
	mu    sync.RWMutex
	db    *sql.DB
	path  string
	state domain.State
}

// Open opens a SQLite database. When the database is empty, the first readable
// legacy JSON path is imported once; the JSON file itself is left untouched.
func Open(path string, legacyJSONPaths ...string) (*Store, error) {
	if path == "" {
		return nil, errors.New("database path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// SQLite serializes writes. A single pooled connection also guarantees that
	// connection-scoped PRAGMAs are applied consistently.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	s := &Store{db: db, path: path}
	if err := s.configure(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}

	state, initialized, err := s.readState()
	if err != nil {
		db.Close()
		return nil, err
	}
	if !initialized {
		state, err = initialState(path, legacyJSONPaths)
		if err != nil {
			db.Close()
			return nil, err
		}
		if err := s.replaceLocked(state); err != nil {
			db.Close()
			return nil, err
		}
	}
	normalized, err := domain.Normalize(state)
	if err != nil {
		db.Close()
		return nil, err
	}
	s.state = normalized
	return s, nil
}

func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.Close()
}

func (s *Store) Get() domain.State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	data, _ := json.Marshal(s.state)
	var copy domain.State
	_ = json.Unmarshal(data, &copy)
	return copy
}

func (s *Store) Replace(state domain.State) error {
	normalized, err := domain.Normalize(state)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.replaceLocked(normalized); err != nil {
		return err
	}
	s.state = normalized
	return nil
}

func (s *Store) configure() error {
	for _, statement := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = NORMAL",
		"PRAGMA busy_timeout = 5000",
	} {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("configure sqlite: %w", err)
		}
	}
	return s.db.Ping()
}

func (s *Store) migrate() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	statements := []string{
		`CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS categories (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			color TEXT NOT NULL,
			sort_order INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS pool_items (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			scope TEXT NOT NULL CHECK (scope IN ('week', 'month')),
			duration INTEGER NOT NULL CHECK (duration BETWEEN 15 AND 480),
			priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
			category_id TEXT NOT NULL REFERENCES categories(id),
			note TEXT NOT NULL DEFAULT '',
			scheduled INTEGER NOT NULL DEFAULT 0 CHECK (scheduled IN (0, 1)),
			sort_order INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS plans (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			plan_date TEXT NOT NULL,
			start_time TEXT NOT NULL,
			end_time TEXT NOT NULL,
			category_id TEXT NOT NULL REFERENCES categories(id),
			note TEXT NOT NULL DEFAULT '',
			completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
			source TEXT NOT NULL CHECK (source IN ('manual', 'quick', 'ai')),
			pool_id TEXT NOT NULL DEFAULT '',
			sort_order INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS app_settings (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			theme TEXT NOT NULL CHECK (theme IN ('light', 'dark')),
			calendar_width INTEGER NOT NULL CHECK (calendar_width BETWEEN 70 AND 100),
			start_hour INTEGER NOT NULL CHECK (start_hour BETWEEN 0 AND 22),
			end_hour INTEGER NOT NULL CHECK (end_hour BETWEEN 2 AND 24),
			hour_height INTEGER NOT NULL CHECK (hour_height BETWEEN 40 AND 72),
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS countdown_timer (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			plan_id TEXT NOT NULL DEFAULT '',
			label TEXT NOT NULL,
			duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 1 AND 359999),
			remaining_seconds INTEGER NOT NULL CHECK (remaining_seconds BETWEEN 0 AND 359999),
			ends_at TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'paused', 'finished')),
			updated_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_plans_date_time ON plans(plan_date, start_time)`,
		`CREATE INDEX IF NOT EXISTS idx_plans_completed ON plans(completed)`,
		`CREATE INDEX IF NOT EXISTS idx_pool_scope_scheduled ON pool_items(scope, scheduled)`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("apply database schema: %w", err)
		}
	}
	if _, err := tx.Exec(
		"INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
		schemaVersion,
		time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) readState() (domain.State, bool, error) {
	var state domain.State
	err := s.db.QueryRow(`SELECT theme, calendar_width, start_hour, end_hour, hour_height FROM app_settings WHERE id = 1`).Scan(
		&state.Settings.Theme,
		&state.Settings.CalendarWidth,
		&state.Settings.Timeline.StartHour,
		&state.Settings.Timeline.EndHour,
		&state.Settings.Timeline.HourHeight,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.State{}, false, nil
	}
	if err != nil {
		return domain.State{}, false, err
	}
	var timerPlanID, timerEndsAt string
	err = s.db.QueryRow(`SELECT plan_id, label, duration_seconds, remaining_seconds, ends_at, status FROM countdown_timer WHERE id = 1`).Scan(
		&timerPlanID,
		&state.Timer.Label,
		&state.Timer.DurationSeconds,
		&state.Timer.RemainingSeconds,
		&timerEndsAt,
		&state.Timer.Status,
	)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.State{}, false, err
	}
	if err == nil {
		state.Timer.PlanID = timerPlanID
		state.Timer.EndsAt = timerEndsAt
	}

	categoryRows, err := s.db.Query(`SELECT id, label, color FROM categories ORDER BY sort_order, id`)
	if err != nil {
		return domain.State{}, false, err
	}
	for categoryRows.Next() {
		var category domain.Category
		if err := categoryRows.Scan(&category.ID, &category.Label, &category.Color); err != nil {
			categoryRows.Close()
			return domain.State{}, false, err
		}
		state.Categories = append(state.Categories, category)
	}
	if err := categoryRows.Err(); err != nil {
		categoryRows.Close()
		return domain.State{}, false, err
	}
	if err := categoryRows.Close(); err != nil {
		return domain.State{}, false, err
	}

	planRows, err := s.db.Query(`SELECT id, title, plan_date, start_time, end_time, category_id, note, completed, source, pool_id FROM plans ORDER BY sort_order, id`)
	if err != nil {
		return domain.State{}, false, err
	}
	for planRows.Next() {
		var plan domain.Plan
		var completed int
		if err := planRows.Scan(&plan.ID, &plan.Title, &plan.Date, &plan.StartTime, &plan.EndTime, &plan.Category, &plan.Note, &completed, &plan.Source, &plan.PoolID); err != nil {
			planRows.Close()
			return domain.State{}, false, err
		}
		plan.Completed = completed != 0
		state.Plans = append(state.Plans, plan)
	}
	if err := planRows.Err(); err != nil {
		planRows.Close()
		return domain.State{}, false, err
	}
	if err := planRows.Close(); err != nil {
		return domain.State{}, false, err
	}

	poolRows, err := s.db.Query(`SELECT id, title, scope, duration, priority, category_id, note, scheduled FROM pool_items ORDER BY sort_order, id`)
	if err != nil {
		return domain.State{}, false, err
	}
	for poolRows.Next() {
		var item domain.PoolItem
		var scheduled int
		if err := poolRows.Scan(&item.ID, &item.Title, &item.Scope, &item.Duration, &item.Priority, &item.Category, &item.Note, &scheduled); err != nil {
			poolRows.Close()
			return domain.State{}, false, err
		}
		item.Scheduled = scheduled != 0
		state.PoolItems = append(state.PoolItems, item)
	}
	if err := poolRows.Err(); err != nil {
		poolRows.Close()
		return domain.State{}, false, err
	}
	if err := poolRows.Close(); err != nil {
		return domain.State{}, false, err
	}
	return state, true, nil
}

func (s *Store) replaceLocked(state domain.State) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"plans", "pool_items", "categories"} {
		if _, err := tx.Exec("DELETE FROM " + table); err != nil {
			return err
		}
	}

	for index, category := range state.Categories {
		if _, err := tx.Exec(`INSERT INTO categories(id, label, color, sort_order) VALUES (?, ?, ?, ?)`, category.ID, category.Label, category.Color, index); err != nil {
			return err
		}
	}
	for index, item := range state.PoolItems {
		if _, err := tx.Exec(`INSERT INTO pool_items(id, title, scope, duration, priority, category_id, note, scheduled, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			item.ID, item.Title, item.Scope, item.Duration, item.Priority, item.Category, item.Note, item.Scheduled, index,
		); err != nil {
			return err
		}
	}
	for index, plan := range state.Plans {
		if _, err := tx.Exec(`INSERT INTO plans(id, title, plan_date, start_time, end_time, category_id, note, completed, source, pool_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			plan.ID, plan.Title, plan.Date, plan.StartTime, plan.EndTime, plan.Category, plan.Note, plan.Completed, plan.Source, plan.PoolID, index,
		); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`INSERT INTO app_settings(id, theme, calendar_width, start_hour, end_hour, hour_height, updated_at)
		VALUES (1, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET theme = excluded.theme, calendar_width = excluded.calendar_width,
		start_hour = excluded.start_hour, end_hour = excluded.end_hour, hour_height = excluded.hour_height,
		updated_at = excluded.updated_at`,
		state.Settings.Theme,
		state.Settings.CalendarWidth,
		state.Settings.Timeline.StartHour,
		state.Settings.Timeline.EndHour,
		state.Settings.Timeline.HourHeight,
		time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO countdown_timer(id, plan_id, label, duration_seconds, remaining_seconds, ends_at, status, updated_at)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET plan_id = excluded.plan_id, label = excluded.label,
		duration_seconds = excluded.duration_seconds, remaining_seconds = excluded.remaining_seconds,
		ends_at = excluded.ends_at, status = excluded.status, updated_at = excluded.updated_at`,
		state.Timer.PlanID,
		state.Timer.Label,
		state.Timer.DurationSeconds,
		state.Timer.RemainingSeconds,
		state.Timer.EndsAt,
		state.Timer.Status,
		time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		return err
	}
	return tx.Commit()
}

func initialState(databasePath string, legacyJSONPaths []string) (domain.State, error) {
	seen := make(map[string]bool, len(legacyJSONPaths))
	for _, path := range legacyJSONPaths {
		if path == "" || filepath.Clean(path) == filepath.Clean(databasePath) || seen[path] {
			continue
		}
		seen[path] = true
		data, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return domain.State{}, fmt.Errorf("read legacy JSON: %w", err)
		}
		var state domain.State
		if err := json.Unmarshal(data, &state); err != nil {
			return domain.State{}, fmt.Errorf("decode legacy JSON %s: %w", path, err)
		}
		return domain.Normalize(state)
	}
	return domain.DefaultState(time.Now()), nil
}
