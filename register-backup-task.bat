@echo off
chcp 65001 >nul
REM 매주 금요일 저녁 자동 백업을 Windows 작업 스케줄러에 등록합니다.
REM 사용법: 이 파일을 마우스 오른쪽 버튼 → "관리자 권한으로 실행"
REM 시간을 바꾸려면 명령 프롬프트에서:  register-backup-task.bat 20:30
cd /d %~dp0
set TIME_AT=%~1
if "%TIME_AT%"=="" set TIME_AT=19:00

net session >nul 2>&1
if errorlevel 1 (
  echo [안내] 관리자 권한이 필요합니다. 파일을 마우스 오른쪽 버튼으로 눌러 "관리자 권한으로 실행" 하세요.
  pause
  exit /b 1
)

schtasks /Create /F /TN "RnDSchedule\WeeklyBackup" /SC WEEKLY /D FRI /ST %TIME_AT% /RU SYSTEM /RL HIGHEST /TR "\"%~dp0backup.bat\" /auto"
if errorlevel 1 (
  echo 등록에 실패했습니다. 위 메시지를 확인하세요.
  pause
  exit /b 1
)
echo.
echo 등록 완료: 매주 금요일 %TIME_AT% 에 DB 백업을 실행합니다.
echo  - 확인: 작업 스케줄러 ^> 작업 스케줄러 라이브러리 ^> RnDSchedule ^> WeeklyBackup
echo  - 지금 한 번 시험:  schtasks /Run /TN "RnDSchedule\WeeklyBackup"
echo  - 결과는 프로그램의 [관리] 화면 "DB 백업" 카드에서 볼 수 있습니다.
echo  - 등록 해제:  schtasks /Delete /TN "RnDSchedule\WeeklyBackup" /F
pause
