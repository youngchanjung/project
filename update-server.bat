@echo off
chcp 65001 >nul
REM GitHub 에서 최신 버전을 받아 다시 빌드합니다. 실행 후 서버를 다시 시작하세요.
cd /d %~dp0
git pull || goto :err
call npm install || goto :err
call npm run build || goto :err
echo 업데이트 완료. 서버를 다시 시작하세요.
pause
goto :eof
:err
echo 오류가 발생했습니다. 위 메시지를 확인하세요.
pause
