@echo off
chcp 65001 >nul
REM 일정관리 DB 백업. 작업 스케줄러가 매주 금요일 저녁 "backup.bat /auto" 로 실행합니다.
REM 직접 더블클릭해서 지금 바로 백업할 수도 있습니다.
cd /d %~dp0
call npm run backup --silent
set RC=%ERRORLEVEL%
if /i not "%~1"=="/auto" pause
exit /b %RC%
