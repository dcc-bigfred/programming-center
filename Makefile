# programming-center — Rust (axum) + embedded React SPA
#
# Standalone repo: https://github.com/dcc-bigfred/programming-center
# Hub integration: bigfred-os Buildroot package `package/programming-center`

TARGET  ?= aarch64-unknown-linux-musl
WEB_DIR := web
CARGO   ?= cargo
NPM     ?= npm
export RUSTUP_TOOLCHAIN ?= stable
CARGO_TARGET_DIR ?= $(CURDIR)/target
export CARGO_TARGET_DIR

CONFIG ?= $(CURDIR)/dev-config.json

BIGFRED_OS_ROOT ?= $(abspath $(CURDIR)/../bigfred-os)
BR_HOST_GCC := $(BIGFRED_OS_ROOT)/os/output/host/bin/aarch64-buildroot-linux-musl-gcc
ifeq ($(wildcard $(BR_HOST_GCC)),)
  LINKER ?= aarch64-linux-musl-gcc
else
  LINKER ?= $(BR_HOST_GCC)
endif

.PHONY: all build web-build release-musl host test test-web test-release-assertions \
	fmt clippy clean dist dev-backend dev-web deploy-hub update-deps

all: build

web-build:
	@command -v $(NPM) >/dev/null 2>&1 || { \
		echo "error: npm not found — needed for the embedded SPA" >&2; \
		exit 127; \
	}
	@echo "==> web (vite)"
	cd "$(WEB_DIR)" && $(NPM) ci && $(NPM) run build

build host: | web-build

host:
	$(CARGO) build --release
	@echo "wrote $(CARGO_TARGET_DIR)/release/programming-center"

build:
	@command -v $(CARGO) >/dev/null 2>&1 || { \
		echo "error: cargo not found" >&2; \
		exit 127; \
	}
	@command -v "$(LINKER)" >/dev/null 2>&1 || { \
		echo "error: aarch64 musl linker not found: $(LINKER)" >&2; \
		echo "       build bigfred-os host tools, or install aarch64-linux-musl-gcc" >&2; \
		exit 127; \
	}
	@echo "==> programming-center ($(TARGET)) linker=$(LINKER)"
	CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER="$(LINKER)" \
	CC_aarch64_unknown_linux_musl="$(LINKER)" \
	RUSTFLAGS='-C target-feature=+crt-static' \
		$(CARGO) build --release --target $(TARGET)
	@mkdir -p dist
	cp -f "$(CARGO_TARGET_DIR)/$(TARGET)/release/programming-center" dist/programming-center-linux-arm64
	chmod 755 dist/programming-center-linux-arm64
	@echo "wrote dist/programming-center-linux-arm64"

release-musl: build

dist: release-musl

test:
	$(CARGO) test --locked
	$(MAKE) test-web

test-web:
	@command -v $(NPM) >/dev/null 2>&1 || { \
		echo "error: npm not found — needed for SPA unit tests" >&2; \
		exit 127; \
	}
	cd "$(WEB_DIR)" && $(NPM) test

test-release-assertions:
	$(CARGO) test --locked --profile release-assertions

fmt:
	$(CARGO) fmt --all

clippy:
	$(CARGO) clippy --all-targets -- -D warnings

update-deps:
	$(CARGO) update \
		-p dcc-bigfred-proto-z21 \
		-p bigfred-shared-daemon

dev-backend:
	RUST_LOG=$${RUST_LOG:-info,programming_center=debug,tower_http=info} $(CARGO) run

dev-web:
	cd "$(WEB_DIR)" && HOST=0.0.0.0 $(NPM) run dev

clean:
	$(CARGO) clean
	rm -rf "$(WEB_DIR)/node_modules" dist
	find "$(WEB_DIR)/dist" -mindepth 1 ! -name .gitkeep -exec rm -rf {} + 2>/dev/null || true

HUB ?= 192.168.0.1
HUB_USER ?= root
HUB_SSH ?= $(HUB_USER)@$(HUB)
SCP ?= scp
SCP_OPTS ?= -O
SSH ?= ssh
DIST_ARM64 ?= dist/programming-center-linux-arm64
HUB_BIN_DIR ?= /data/opt/bigfred/bin

deploy-hub: release-musl
	@test -f $(DIST_ARM64) || { echo "error: $(DIST_ARM64) missing — run make release-musl" >&2; exit 1; }
	$(SSH) $(HUB_SSH) 'mkdir -p $(HUB_BIN_DIR)'
	$(SCP) $(SCP_OPTS) $(DIST_ARM64) $(HUB_SSH):$(HUB_BIN_DIR)/.programming-center.new
	$(SSH) $(HUB_SSH) 'set -e; \
		cd $(HUB_BIN_DIR); \
		chmod 755 .programming-center.new; \
		mv -f .programming-center.new programming-center; \
		microinit restart programming-center'
