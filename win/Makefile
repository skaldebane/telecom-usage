PREFIX ?= $(HOME)/.local
DATA_DIR = $(PREFIX)/share/inwi-win
BIN_DIR = $(PREFIX)/bin

install:
	mkdir -p $(BIN_DIR)
	install -Dm 755 win_ma.py $(DATA_DIR)/win.py
	ln -sf $(abspath $(DATA_DIR)/win.py) $(BIN_DIR)/win

uninstall:
	rm -f $(BIN_DIR)/win
	rm -rf $(DATA_DIR)

.PHONY: install uninstall
