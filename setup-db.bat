@echo off
chcp 65001 >nul
setlocal
REM PostgreSQL 에 일정관리용 계정(schedule)과 DB(schedule)를 만들고 .env 를 작성합니다.
REM PostgreSQL 을 먼저 설치하세요 (docs\설치가이드_Windows.md 참고). 처음 한 번만 실행합니다.
cd /d %~dp0

set PSQL=
for /d %%V in ("C:\Program Files\PostgreSQL\*") do if exist "%%V\bin\psql.exe" set "PSQL=%%V\bin\psql.exe"
if "%PSQL%"=="" (
  where psql >nul 2>&1 && set PSQL=psql
)
if "%PSQL%"=="" (
  echo PostgreSQL 을 찾지 못했습니다. 먼저 PostgreSQL 을 설치하세요.
  pause
  exit /b 1
)
echo 사용할 psql: %PSQL%
echo.
set /p PGPASSWORD=PostgreSQL 설치 때 정한 postgres 관리자 비밀번호: 
echo.
echo 일정관리 프로그램이 DB 에 접속할 때 쓸 새 비밀번호를 정하세요.
echo (영문·숫자만 사용, @ : / # 같은 기호는 쓰지 마세요)
set /p DBPASS=새 비밀번호: 
if "%DBPASS%"=="" (
  echo 비밀번호를 입력하지 않았습니다.
  pause
  exit /b 1
)

"%PSQL%" -U postgres -h localhost -v ON_ERROR_STOP=1 -c "CREATE ROLE schedule LOGIN PASSWORD '%DBPASS%';" || goto :err
"%PSQL%" -U postgres -h localhost -v ON_ERROR_STOP=1 -c "CREATE DATABASE schedule OWNER schedule ENCODING 'UTF8' TEMPLATE template0;" || goto :err

if exist .env (
  echo.
  echo .env 파일이 이미 있어 그대로 둡니다. 아래 줄을 .env 에 직접 넣으세요:
  echo   DB_CLIENT=pg
  echo   DATABASE_URL=postgres://schedule:%DBPASS%@localhost:5432/schedule
) else (
  (
    echo PORT=3000
    echo DB_CLIENT=pg
    echo DATABASE_URL=postgres://schedule:%DBPASS%@localhost:5432/schedule
    echo SESSION_DAYS=14
    echo BACKUP_KEEP=12
    echo # DeepL 번역: 앞의 # 을 지우고 키를 넣으세요
    echo # DEEPL_API_KEY=
  ) > .env
  echo .env 파일을 만들었습니다.
)
echo.
echo DB 준비 완료. 이제 start-server.bat 을 실행하세요.
pause
exit /b 0

:err
echo.
echo DB 만들기에 실패했습니다. postgres 비밀번호가 맞는지, 이미 만들어져 있지 않은지 확인하세요.
pause
exit /b 1
