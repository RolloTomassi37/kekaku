package mailer

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
	"testing"
	"time"
)

func TestBuildMessageAttachesCalendarForIPhone(t *testing.T) {
	ics := []byte("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n")
	raw, err := buildMessage(CalendarMessage{
		Host: "smtp.163.com", Port: 465, Sender: "bluecat16384@163.com", Recipient: "bluecat16384@163.com",
		Subject: "Kekaku 日历计划", Body: "请在 iPhone 邮件中打开附件。", AttachmentName: "kekaku-calendar.ics", Attachment: ics,
	}, time.Date(2026, 8, 27, 10, 0, 0, 0, time.FixedZone("CST", 8*60*60)))
	if err != nil {
		t.Fatal(err)
	}
	message, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	mediaType, parameters, err := mime.ParseMediaType(message.Header.Get("Content-Type"))
	if err != nil || mediaType != "multipart/mixed" {
		t.Fatalf("Content-Type = %q params=%v err=%v", mediaType, parameters, err)
	}
	reader := multipart.NewReader(message.Body, parameters["boundary"])
	parts := 0
	foundCalendar := false
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		parts++
		if strings.HasPrefix(part.Header.Get("Content-Type"), "text/calendar") {
			encoded, _ := io.ReadAll(part)
			decoded, err := io.ReadAll(base64.NewDecoder(base64.StdEncoding, bytes.NewReader(encoded)))
			if err != nil {
				t.Fatal(err)
			}
			foundCalendar = bytes.Equal(decoded, ics)
		}
	}
	if parts != 2 || !foundCalendar {
		t.Fatalf("parts=%d foundCalendar=%v", parts, foundCalendar)
	}
}
