package calendarics

import (
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/RolloTomassi37/kekaku/backend/internal/domain"
)

const timezoneName = "Asia/Shanghai"

func Build(plans []domain.Plan, categories []domain.Category, calendarName string, now time.Time) ([]byte, error) {
	if len(plans) == 0 {
		return nil, fmt.Errorf("calendar has no plans")
	}
	location := time.FixedZone(timezoneName, 8*60*60)
	categoryLabels := make(map[string]string, len(categories))
	for _, category := range categories {
		categoryLabels[category.ID] = category.Label
	}
	sortedPlans := append([]domain.Plan(nil), plans...)
	sort.SliceStable(sortedPlans, func(i, j int) bool {
		return sortedPlans[i].Date+sortedPlans[i].StartTime < sortedPlans[j].Date+sortedPlans[j].StartTime
	})
	stamp := formatUTC(now)
	lines := []string{
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Kekaku//iPhone Calendar Mailer//ZH-CN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"X-WR-CALNAME:" + escapeText(calendarName),
		"X-WR-TIMEZONE:" + timezoneName,
	}
	for index, plan := range sortedPlans {
		start, err := time.ParseInLocation("2006-01-02 15:04", plan.Date+" "+plan.StartTime, location)
		if err != nil {
			return nil, fmt.Errorf("parse start time for plan %q: %w", plan.Title, err)
		}
		end, err := time.ParseInLocation("2006-01-02 15:04", plan.Date+" "+plan.EndTime, location)
		if err != nil {
			return nil, fmt.Errorf("parse end time for plan %q: %w", plan.Title, err)
		}
		if !end.After(start) {
			end = start.Add(30 * time.Minute)
		}
		title := plan.Title
		status := "状态：待完成"
		if plan.Completed {
			title = "【已完成】" + title
			status = "状态：已完成"
		}
		description := strings.TrimSpace(strings.Join(nonEmpty(plan.Note, status), "\n"))
		category := categoryLabels[plan.Category]
		if category == "" {
			category = "个人"
		}
		lines = append(lines,
			"BEGIN:VEVENT",
			fmt.Sprintf("UID:%s-%d@kekaku.local", safeID(plan.ID), index+1),
			"DTSTAMP:"+stamp,
			"DTSTART:"+formatUTC(start),
			"DTEND:"+formatUTC(end),
			"SUMMARY:"+escapeText(title),
			"LOCATION:",
			"DESCRIPTION:"+escapeText(description),
			"CATEGORIES:"+escapeText(category),
			"STATUS:CONFIRMED",
			"TRANSP:OPAQUE",
			"END:VEVENT",
		)
	}
	lines = append(lines, "END:VCALENDAR")
	folded := make([]string, 0, len(lines))
	for _, line := range lines {
		folded = append(folded, foldLine(line)...)
	}
	return []byte(strings.Join(folded, "\r\n") + "\r\n"), nil
}

func formatUTC(value time.Time) string {
	return value.UTC().Format("20060102T150405Z")
}

func escapeText(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, ";", "\\;")
	value = strings.ReplaceAll(value, ",", "\\,")
	value = strings.ReplaceAll(value, "\r\n", "\\n")
	value = strings.ReplaceAll(value, "\n", "\\n")
	return value
}

func foldLine(line string) []string {
	if len([]byte(line)) <= 75 {
		return []string{line}
	}
	result := []string{}
	current := ""
	for _, character := range line {
		candidate := current + string(character)
		if current != "" && len([]byte(candidate)) > 75 {
			result = append(result, current)
			current = " " + string(character)
		} else {
			current = candidate
		}
	}
	return append(result, current)
}

func safeID(value string) string {
	value = strings.Map(func(character rune) rune {
		if unicode.IsLetter(character) || unicode.IsDigit(character) || character == '-' || character == '_' || character == '.' {
			return character
		}
		return '-'
	}, value)
	if value == "" {
		return "plan"
	}
	return value
}

func nonEmpty(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, value)
		}
	}
	return result
}
