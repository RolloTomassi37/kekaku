package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/RolloTomassi37/kekaku/backend/internal/domain"
)

type Store struct {
	mu    sync.RWMutex
	path  string
	state domain.State
}

func Open(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("data file path is required")
	}
	s := &Store{path: path}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		s.state = domain.DefaultState(time.Now())
		if err := s.writeLocked(s.state); err != nil {
			return nil, err
		}
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &s.state); err != nil {
		return nil, err
	}
	normalized, err := domain.Normalize(s.state)
	if err != nil {
		return nil, err
	}
	s.state = normalized
	return s, nil
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
	if err := s.writeLocked(normalized); err != nil {
		return err
	}
	s.state = normalized
	return nil
}

func (s *Store) writeLocked(state domain.State) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(s.path), ".kekaku-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if _, err = temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err = temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err = temp.Close(); err != nil {
		return err
	}
	if err = os.Rename(tempPath, s.path); err != nil {
		if removeErr := os.Remove(s.path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return err
		}
		if err = os.Rename(tempPath, s.path); err != nil {
			return err
		}
	}
	return nil
}
