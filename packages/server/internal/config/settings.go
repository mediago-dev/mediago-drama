package config

import (
	"os"
	"path/filepath"
)

// DefaultSettingsDBPath returns the fallback settings database path.
func DefaultSettingsDBPath() string {
	configDir, err := os.UserConfigDir()
	if err == nil && configDir != "" {
		return filepath.Join(configDir, "mediago-drama", "settings.db")
	}

	homeDir, err := os.UserHomeDir()
	if err == nil && homeDir != "" {
		return filepath.Join(homeDir, ".mediago-drama", "settings.db")
	}

	return filepath.Join(".", ".mediago-drama", "settings.db")
}
