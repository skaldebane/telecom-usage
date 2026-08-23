install:
	$(MAKE) -C orange install
	$(MAKE) -C win install

uninstall:
	$(MAKE) -C orange uninstall
	$(MAKE) -C win uninstall

install-orange:
	$(MAKE) -C orange install

install-win:
	$(MAKE) -C win install

.PHONY: install uninstall install-orange install-win
