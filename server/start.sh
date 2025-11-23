#!/bin/bash

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Warning: .env file not found. Creating from .env.example..."
    cp .env.example .env
    echo "Please edit .env and set your AUTH_TOKEN, then run this script again."
    exit 1
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Generate timestamp for log filename
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="logs/server_${TIMESTAMP}.log"

# Start the server in the background and redirect output to log file
echo "Starting GDSJam signaling server..."
echo "Log file: $LOG_FILE"

# Load .env and start server
export $(cat .env | grep -v '^#' | xargs)
nohup node server.js > "$LOG_FILE" 2>&1 &

# Save the process ID
echo $! > .server.pid

echo "Server started with PID $(cat .server.pid)"
echo "To stop the server, run: ./stop.sh"
echo "To view logs, run: tail -f $LOG_FILE"
