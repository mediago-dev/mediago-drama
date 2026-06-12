package logger

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type dailyFileWriter struct {
	mu          sync.Mutex
	basePath    string
	now         func() time.Time
	file        *os.File
	date        string
	currentPath string
}

func newDailyFileWriter(basePath string, now func() time.Time) (*dailyFileWriter, error) {
	if now == nil {
		now = timeNow
	}
	writer := &dailyFileWriter{
		basePath: strings.TrimSpace(basePath),
		now:      now,
	}
	if writer.basePath == "" {
		writer.basePath = DefaultLogPath()
	}
	if err := writer.rotateLocked(); err != nil {
		return nil, err
	}
	return writer, nil
}

func (writer *dailyFileWriter) Write(payload []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()

	if err := writer.rotateLocked(); err != nil {
		return 0, err
	}
	return writer.file.Write(payload)
}

func (writer *dailyFileWriter) Close() error {
	writer.mu.Lock()
	defer writer.mu.Unlock()

	if writer.file == nil {
		return nil
	}
	err := writer.file.Close()
	writer.file = nil
	return err
}

func (writer *dailyFileWriter) CurrentPath() string {
	writer.mu.Lock()
	defer writer.mu.Unlock()

	return writer.currentPath
}

func (writer *dailyFileWriter) rotateLocked() error {
	date := writer.now().Format("2006-01-02")
	if writer.file != nil && writer.date == date {
		return nil
	}

	nextPath := datedLogPath(writer.basePath, date)
	if err := os.MkdirAll(filepath.Dir(nextPath), 0o700); err != nil {
		return err
	}
	nextFile, err := os.OpenFile(nextPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}

	if writer.file != nil {
		_ = writer.file.Close()
	}
	writer.file = nextFile
	writer.date = date
	writer.currentPath = nextPath
	return nil
}

func datedLogPath(basePath string, date string) string {
	dir := filepath.Dir(basePath)
	base := filepath.Base(basePath)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	if stem == "" {
		stem = "server"
	}
	return filepath.Join(dir, stem+"-"+date+ext)
}

func timeNow() time.Time {
	return time.Now()
}
