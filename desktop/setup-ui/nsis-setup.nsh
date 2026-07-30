; NSIS silencioso: sin ventana verde. Deja el helper en disco (apertura rápida)
; y lanza la UI custom aunque el modo sea silent.
!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "EyedOptimizer"
!macroend

!macro customInit
  SetSilent silent
!macroend

!macro customInstallMode
  ; current user (perMachine=false en package.json)
!macroend

!macro customInstall
  ; electron-builder no ejecuta runAfterFinish en silent → forzamos el launch
  Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend
