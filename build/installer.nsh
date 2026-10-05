!macro customInstall
  CreateDirectory "$INSTDIR\config"
  nsExec::ExecToLog 'icacls "$INSTDIR\config" /grant *S-1-5-32-545:(OI)(CI)M'
  Pop $0
  nsExec::ExecToLog 'icacls "$INSTDIR" /grant *S-1-5-32-545:(WD,AD)'
  Pop $0
!macroend
