#!/bin/bash
cd /home/ubuntu/gdsjam/server
node cleanup.js >> logs/cleanup.log 2>&1
