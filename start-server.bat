@echo off
chcp 65001 >nul
REM 일정관리 서버 실행 (Windows 서버 PC)
cd /d %~dp0
if not exist node_modules (
  echo 처음 실행: 필요한 프로그램을 설치합니다...
  call npm install || goto :err
)
if not exist web\dist\index.html (
  echo 화면을 빌드합니다...
  call npm run build || goto :err
)
call npm start
goto :eof
:err
echo 오류가 발생했습니다. 위 메시지를 확인하세요.
pause
