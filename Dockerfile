# Headless TeslaCam Browser (server mode).
# Adapted from the Dockerfile in pull request #75 by Shaheen Badiyan.
# node:22-bookworm-slim comes with yarn 1 and is published for both amd64
# and arm64, so this builds on x64, Apple Silicon, and a Raspberry Pi
# without a second Dockerfile.
FROM node:22-bookworm-slim

WORKDIR /usr/src/teslacam-browser

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --ignore-scripts

COPY . .

EXPOSE 8088
VOLUME ["/media/TeslaCam"]
ENTRYPOINT ["node", "server.js"]
CMD ["/media/TeslaCam"]
