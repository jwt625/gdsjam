#!/bin/bash

if [ ! -f .server.pid ]; then
    echo "No server PID file found. Is the server running?"
    exit 1
fi

PID=$(cat .server.pid)

if ps -p $PID > /dev/null; then
    echo "Stopping server (PID: $PID)..."
    kill $PID
    rm .server.pid
    echo "Server stopped."
else
    echo "Server process (PID: $PID) not found. Cleaning up PID file..."
    rm .server.pid
fi
