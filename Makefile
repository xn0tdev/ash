# Ash (Wails/Go) — build helpers.
# wails and makensis live outside the default PATH on this machine, so the
# PATH below folds in GOPATH/bin and scoop shims. Override via env if needed.

GOPATH_BIN := $(shell go env GOPATH)/bin
SCOOP_SHIMS := $(HOME)/scoop/shims
PATH := $(PATH):$(GOPATH_BIN):$(SCOOP_SHIMS)

OUTPUT := Ash
BUILD_DIR := build/bin
EXE := $(BUILD_DIR)/$(OUTPUT).exe
INSTALLER := $(BUILD_DIR)/$(OUTPUT)-amd64-installer.exe

.PHONY: build installer dev run clean help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

build: ## Build the app (no installer)
	wails build

installer: ## Build the app + NSIS Windows installer
	wails build -nsis

dev: ## Run with hot reload (Vite on port 1420)
	wails dev

run: build ## Build then launch the app
	./$(EXE)

clean: ## Remove build output
	rm -f $(BUILD_DIR)/$(OUTPUT)*.exe
