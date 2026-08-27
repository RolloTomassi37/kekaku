package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type Plan struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Date      string `json:"date"`
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime"`
	Category  string `json:"category"`
	Note      string `json:"note"`
	Completed bool   `json:"completed"`
	Source    string `json:"source"`
	PoolID    string `json:"poolId,omitempty"`
}

type PoolItem struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Scope     string `json:"scope"`
	Duration  int    `json:"duration"`
	Priority  string `json:"priority"`
	Category  string `json:"category"`
	Note      string `json:"note"`
	Scheduled bool   `json:"scheduled"`
}

type Category struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Color string `json:"color"`
}

type Timeline struct {
	StartHour  int `json:"startHour"`
	EndHour    int `json:"endHour"`
	HourHeight int `json:"hourHeight"`
}

type CountdownTimer struct {
	PlanID           string `json:"planId,omitempty"`
	Label            string `json:"label"`
	DurationSeconds  int    `json:"durationSeconds"`
	RemainingSeconds int    `json:"remainingSeconds"`
	EndsAt           string `json:"endsAt,omitempty"`
	Status           string `json:"status"`
}

type Settings struct {
	Theme         string   `json:"theme"`
	CalendarWidth int      `json:"calendarWidth"`
	Timeline      Timeline `json:"timeline"`
}

type State struct {
	Plans      []Plan         `json:"plans"`
	PoolItems  []PoolItem     `json:"poolItems"`
	Categories []Category     `json:"categories"`
	Settings   Settings       `json:"settings"`
	Timer      CountdownTimer `json:"timer"`
}

var allowedColors = map[string]bool{"violet": true, "sky": true, "emerald": true, "amber": true, "zinc": true}

func DefaultState(now time.Time) State {
	dayOffset := (int(now.Weekday()) + 6) % 7
	monday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -dayOffset)
	date := func(offset int) string { return monday.AddDate(0, 0, offset).Format("2006-01-02") }
	return State{
		Categories: []Category{{ID: "personal", Label: "个人", Color: "amber"}, {ID: "work", Label: "工作", Color: "violet"}, {ID: "study", Label: "学习", Color: "sky"}},
		Settings:   Settings{Theme: "light", CalendarWidth: 100, Timeline: Timeline{StartHour: 6, EndHour: 23, HourHeight: 48}},
		Timer:      CountdownTimer{Label: "专注计时", DurationSeconds: 5 * 60, RemainingSeconds: 5 * 60, Status: "idle"},
		Plans: []Plan{
			{ID: "sample-1", Title: "梳理本周目标", Date: date(0), StartTime: "09:30", EndTime: "10:30", Category: "personal", Note: "只保留三个最重要的结果。", Source: "manual"},
			{ID: "sample-2", Title: "产品方案评审", Date: date(2), StartTime: "10:00", EndTime: "11:30", Category: "work", Note: "确认范围、负责人和交付节点。", Source: "manual"},
			{ID: "sample-3", Title: "健身 · 上肢训练", Date: date(2), StartTime: "16:00", EndTime: "17:00", Category: "personal", Source: "manual"},
			{ID: "sample-4", Title: "阅读与笔记", Date: date(3), StartTime: "20:00", EndTime: "21:00", Category: "study", Note: "读完第二章，整理五条笔记。", Source: "manual"},
		},
		PoolItems: []PoolItem{
			{ID: "pool-1", Title: "准备产品发布材料", Scope: "week", Duration: 180, Priority: "high", Category: "work", Note: "整理发布清单、文案和演示素材"},
			{ID: "pool-2", Title: "完成季度阅读清单", Scope: "week", Duration: 120, Priority: "medium", Category: "study", Note: "读完剩余章节并做摘录"},
			{ID: "pool-3", Title: "整理旅行照片", Scope: "month", Duration: 90, Priority: "low", Category: "personal", Note: "筛选、归档并挑选 20 张"},
		},
	}
}

func Normalize(state State) (State, error) {
	if len(state.Plans) > 5000 || len(state.PoolItems) > 1000 || len(state.Categories) > 12 {
		return State{}, errors.New("state exceeds allowed limits")
	}
	if len(state.Categories) == 0 {
		state.Categories = DefaultState(time.Now()).Categories
	}
	categoryIDs := make(map[string]bool, len(state.Categories))
	hasPersonal := false
	for i := range state.Categories {
		category := &state.Categories[i]
		category.ID = strings.TrimSpace(category.ID)
		category.Label = strings.TrimSpace(category.Label)
		if category.ID == "" || category.Label == "" || categoryIDs[category.ID] {
			return State{}, fmt.Errorf("invalid category at index %d", i)
		}
		if len([]rune(category.Label)) > 12 {
			return State{}, fmt.Errorf("category label is too long")
		}
		if !allowedColors[category.Color] {
			category.Color = "zinc"
		}
		categoryIDs[category.ID] = true
		hasPersonal = hasPersonal || category.ID == "personal"
	}
	if !hasPersonal {
		state.Categories = append([]Category{{ID: "personal", Label: "个人", Color: "amber"}}, state.Categories...)
		categoryIDs["personal"] = true
	}
	planTitles := make(map[string]string, len(state.Plans))
	for i := range state.Plans {
		plan := &state.Plans[i]
		plan.ID = strings.TrimSpace(plan.ID)
		plan.Title = strings.TrimSpace(plan.Title)
		if plan.ID == "" || plan.Title == "" || !validDate(plan.Date) || !validTime(plan.StartTime) || !validTime(plan.EndTime) {
			return State{}, fmt.Errorf("invalid plan at index %d", i)
		}
		if !categoryIDs[plan.Category] {
			plan.Category = "personal"
		}
		if plan.Source != "ai" && plan.Source != "quick" {
			plan.Source = "manual"
		}
		planTitles[plan.ID] = plan.Title
	}
	for i := range state.PoolItems {
		item := &state.PoolItems[i]
		item.ID = strings.TrimSpace(item.ID)
		item.Title = strings.TrimSpace(item.Title)
		if item.ID == "" || item.Title == "" {
			return State{}, fmt.Errorf("invalid pool item at index %d", i)
		}
		if item.Scope != "month" {
			item.Scope = "week"
		}
		if item.Priority != "high" && item.Priority != "low" {
			item.Priority = "medium"
		}
		if item.Duration < 15 {
			item.Duration = 15
		}
		if item.Duration > 480 {
			item.Duration = 480
		}
		if !categoryIDs[item.Category] {
			item.Category = "personal"
		}
	}
	if state.Settings.Theme != "dark" {
		state.Settings.Theme = "light"
	}
	state.Settings.CalendarWidth = clamp(state.Settings.CalendarWidth, 70, 100, 100)
	state.Settings.Timeline.StartHour = clamp(state.Settings.Timeline.StartHour, 0, 22, 6)
	state.Settings.Timeline.EndHour = clamp(state.Settings.Timeline.EndHour, state.Settings.Timeline.StartHour+2, 24, 23)
	state.Settings.Timeline.HourHeight = clamp(state.Settings.Timeline.HourHeight, 40, 72, 48)
	state.Timer.PlanID = strings.TrimSpace(state.Timer.PlanID)
	state.Timer.Label = strings.TrimSpace(state.Timer.Label)
	if state.Timer.DurationSeconds < 1 || state.Timer.DurationSeconds > 359999 {
		state.Timer.DurationSeconds = 5 * 60
	}
	if state.Timer.RemainingSeconds < 0 || state.Timer.RemainingSeconds > state.Timer.DurationSeconds {
		state.Timer.RemainingSeconds = state.Timer.DurationSeconds
	}
	if state.Timer.Status != "running" && state.Timer.Status != "paused" && state.Timer.Status != "finished" {
		state.Timer.Status = "idle"
	}
	if state.Timer.Status == "running" {
		if _, err := time.Parse(time.RFC3339, state.Timer.EndsAt); err != nil {
			state.Timer.Status = "paused"
			state.Timer.EndsAt = ""
		}
	} else {
		state.Timer.EndsAt = ""
	}
	if state.Timer.Status == "idle" && state.Timer.RemainingSeconds == 0 {
		state.Timer.RemainingSeconds = state.Timer.DurationSeconds
	}
	if state.Timer.Status == "finished" {
		state.Timer.RemainingSeconds = 0
	}
	if state.Timer.PlanID != "" {
		if title, ok := planTitles[state.Timer.PlanID]; ok {
			if state.Timer.Label == "" {
				state.Timer.Label = title
			}
		} else {
			state.Timer.PlanID = ""
		}
	}
	if state.Timer.Label == "" {
		state.Timer.Label = "专注计时"
	}
	if state.Plans == nil {
		state.Plans = []Plan{}
	}
	if state.PoolItems == nil {
		state.PoolItems = []PoolItem{}
	}
	return state, nil
}

func clamp(value, min, max, fallback int) int {
	if value == 0 {
		value = fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func validDate(value string) bool {
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

func validTime(value string) bool {
	_, err := time.Parse("15:04", value)
	return err == nil
}
