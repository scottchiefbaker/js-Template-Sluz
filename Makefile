.PHONY: all build build-esm build-global test clean

all: build

build:
	npm run build

build-esm:
	npm run build:esm

build-global:
	npm run build:global

test:
	npm test

clean:
	rm -f src/sluz.min.js src/sluz.global.min.js
