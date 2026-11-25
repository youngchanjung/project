@echo off
chcp 65001 >nul
REM 일정관리 서버 실행 (Windows 서버 PC)
cd /d %~dp0
if not exist .env (
  echo .env 파일이 없습니다. 먼저 setup-db.bat 을 실행해 DB 를 준비하세요.
  echo ^(설치 없이 시험만 하려면 .env 에 DB_CLIENT=sqlite 한 줄만 넣어도 됩니다^)
  pause
  exit /b 1
)
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
