package mailer

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"mime"
	"mime/multipart"
	"net"
	"net/smtp"
	"net/textproto"
	"strings"
	"time"
)

type CalendarMessage struct {
	Host           string
	Port           int
	Sender         string
	Recipient      string
	Password       string
	Subject        string
	Body           string
	AttachmentName string
	Attachment     []byte
}

func SendCalendar(ctx context.Context, message CalendarMessage) error {
	if strings.TrimSpace(message.Password) == "" {
		return fmt.Errorf("SMTP authorization code is required")
	}
	rawMessage, err := buildMessage(message, time.Now())
	if err != nil {
		return err
	}
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	rawConnection, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(message.Host, fmt.Sprint(message.Port)))
	if err != nil {
		return fmt.Errorf("connect SMTP server: %w", err)
	}
	tlsConnection := tls.Client(rawConnection, &tls.Config{ServerName: message.Host, MinVersion: tls.VersionTLS12})
	if err := tlsConnection.HandshakeContext(ctx); err != nil {
		rawConnection.Close()
		return fmt.Errorf("establish SMTP TLS: %w", err)
	}
	_ = tlsConnection.SetDeadline(time.Now().Add(45 * time.Second))
	client, err := smtp.NewClient(tlsConnection, message.Host)
	if err != nil {
		tlsConnection.Close()
		return fmt.Errorf("create SMTP client: %w", err)
	}
	defer client.Close()
	if err := client.Auth(smtp.PlainAuth("", message.Sender, message.Password, message.Host)); err != nil {
		return fmt.Errorf("authenticate SMTP account: %w", err)
	}
	if err := client.Mail(message.Sender); err != nil {
		return fmt.Errorf("set SMTP sender: %w", err)
	}
	if err := client.Rcpt(message.Recipient); err != nil {
		return fmt.Errorf("set SMTP recipient: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("start SMTP message: %w", err)
	}
	if _, err := writer.Write(rawMessage); err != nil {
		writer.Close()
		return fmt.Errorf("write SMTP message: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("finish SMTP message: %w", err)
	}
	if err := client.Quit(); err != nil {
		return fmt.Errorf("finish SMTP session: %w", err)
	}
	return nil
}

func buildMessage(message CalendarMessage, now time.Time) ([]byte, error) {
	if message.Host == "" || message.Port == 0 || message.Sender == "" || message.Recipient == "" || len(message.Attachment) == 0 {
		return nil, fmt.Errorf("calendar email configuration is incomplete")
	}
	if message.AttachmentName == "" {
		message.AttachmentName = "kekaku-calendar.ics"
	}
	var multipartBody bytes.Buffer
	multipartWriter := multipart.NewWriter(&multipartBody)
	bodyHeader := textproto.MIMEHeader{}
	bodyHeader.Set("Content-Type", `text/plain; charset="UTF-8"`)
	bodyHeader.Set("Content-Transfer-Encoding", "base64")
	bodyPart, err := multipartWriter.CreatePart(bodyHeader)
	if err != nil {
		return nil, err
	}
	if _, err := bodyPart.Write([]byte(encodeBase64([]byte(message.Body)))); err != nil {
		return nil, err
	}
	attachmentHeader := textproto.MIMEHeader{}
	attachmentHeader.Set("Content-Type", `text/calendar; charset="UTF-8"; method=PUBLISH; name="`+message.AttachmentName+`"`)
	attachmentHeader.Set("Content-Disposition", `attachment; filename="`+message.AttachmentName+`"`)
	attachmentHeader.Set("Content-Transfer-Encoding", "base64")
	attachmentPart, err := multipartWriter.CreatePart(attachmentHeader)
	if err != nil {
		return nil, err
	}
	if _, err := attachmentPart.Write([]byte(encodeBase64(message.Attachment))); err != nil {
		return nil, err
	}
	if err := multipartWriter.Close(); err != nil {
		return nil, err
	}

	var result bytes.Buffer
	result.WriteString("From: " + message.Sender + "\r\n")
	result.WriteString("To: " + message.Recipient + "\r\n")
	result.WriteString("Subject: " + mime.QEncoding.Encode("UTF-8", message.Subject) + "\r\n")
	result.WriteString("Date: " + now.Format(time.RFC1123Z) + "\r\n")
	result.WriteString(fmt.Sprintf("Message-ID: <%d@kekaku.local>\r\n", now.UnixNano()))
	result.WriteString("MIME-Version: 1.0\r\n")
	result.WriteString("Content-Class: urn:content-classes:calendarmessage\r\n")
	result.WriteString(`Content-Type: multipart/mixed; boundary="` + multipartWriter.Boundary() + `"` + "\r\n\r\n")
	result.Write(multipartBody.Bytes())
	return result.Bytes(), nil
}

func encodeBase64(value []byte) string {
	encoded := base64.StdEncoding.EncodeToString(value)
	var result strings.Builder
	for len(encoded) > 76 {
		result.WriteString(encoded[:76])
		result.WriteString("\r\n")
		encoded = encoded[76:]
	}
	result.WriteString(encoded)
	return result.String()
}
