package main

import (
	"log"
	"os"
	"path/filepath"

	"github.com/RolloTomassi37/kekaku/backend/internal/application"
)

func main() {
	executable, err := os.Executable()
	if err != nil {
		log.Printf("无法确定 Kekaku.exe 所在目录：%v", err)
		os.Exit(1)
	}
	if err := os.Chdir(filepath.Dir(executable)); err != nil {
		log.Printf("无法打开 Kekaku.exe 所在目录：%v", err)
		os.Exit(1)
	}
	if application.Run(application.Options{DefaultPort: "8082", OpenBrowser: true}) != nil {
		os.Exit(1)
	}
}
