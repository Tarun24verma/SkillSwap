@echo off
echo Starting SkillSwap PostgreSQL Database on Port 5433...
del /f /q "D:\Program Files\PostgreSQL\data\postmaster.pid" 2>nul
"D:\Program Files\PostgreSQL\bin\pg_ctl.exe" start -D "D:\Program Files\PostgreSQL\data"
"D:\Program Files\PostgreSQL\bin\pg_ctl.exe" status -D "D:\Program Files\PostgreSQL\data"
echo Database is ready!
