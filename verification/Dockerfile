# Headless Linux verification image: no X server, no DISPLAY, no browser.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g @salesforce/cli
ARG PLUGIN_REF=main
RUN echo y | sf plugins install "https://github.com/Damecek/sf-plugin-remote-login.git#${PLUGIN_REF}"
RUN sf plugins | grep sf-plugin-remote-login && sf org login remote --help
