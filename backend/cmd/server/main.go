package main

import (
	"os"

	"github.com/RolloTomassi37/kekaku/backend/internal/application"
)

func main() {
	if application.Run(application.Options{DefaultPort: "8080"}) != nil {
		os.Exit(1)
	}
}
