package calendarics

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/RolloTomassi37/kekaku/backend/internal/domain"
)

func TestBuildCreatesIPhoneFriendlyCalendar(t *testing.T) {
	plans := []domain.Plan{
		{ID: "plan-1", Title: "英语语法课", Date: "2026-08-27", StartTime: "20:00", EndTime: "22:00", Category: "study", Note: "完成两小时课程"},
		{ID: "plan-2", Title: "练琴", Date: "2026-08-27", StartTime: "22:00", EndTime: "23:00", Category: "personal", Completed: true},
	}
	categories := []domain.Category{{ID: "personal", Label: "个人"}, {ID: "study", Label: "学习"}}
	content, err := Build(plans, categories, "Kekaku 全部计划", time.Date(2026, 8, 27, 10, 0, 0, 0, time.FixedZone("CST", 8*60*60)))
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	for _, expected := range []string{
		"BEGIN:VCALENDAR\r\n",
		"METHOD:PUBLISH\r\n",
		"DTSTART:20260827T120000Z\r\n",
		"DTEND:20260827T140000Z\r\n",
		"SUMMARY:英语语法课\r\n",
		"SUMMARY:【已完成】练琴\r\n",
		"END:VCALENDAR\r\n",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("ICS missing %q:\n%s", expected, text)
		}
	}
	if bytes.Contains(content, []byte("\n")) && bytes.Contains(bytes.ReplaceAll(content, []byte("\r\n"), nil), []byte("\n")) {
		t.Fatal("ICS contains a bare LF line ending")
	}
	if strings.Count(text, "BEGIN:VEVENT") != 2 {
		t.Fatalf("VEVENT count = %d", strings.Count(text, "BEGIN:VEVENT"))
	}
	for _, line := range strings.Split(strings.TrimSuffix(text, "\r\n"), "\r\n") {
		if len([]byte(line)) > 75 {
			t.Fatalf("line exceeds 75 octets: %q", line)
		}
	}
}
