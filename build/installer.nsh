!macro customInit
  ${If} $hasPerUserInstallation == "1"
  ${OrIf} $hasPerMachineInstallation == "1"
    RMDir /r "$TEMP\edit-remote-config"
    RMDir /r "$TEMP\edit-remote-erproj"
    Delete "$TEMP\edit-remote-config-location.json"
    ${If} ${FileExists} "$INSTDIR\config\*.*"
      CreateDirectory "$TEMP\edit-remote-config"
      CopyFiles /SILENT "$INSTDIR\config\*.*" "$TEMP\edit-remote-config"
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR\config-location.json"
      CopyFiles /SILENT "$INSTDIR\config-location.json" "$TEMP\edit-remote-config-location.json"
    ${EndIf}
    Push $R8
    Push $R9
    FindFirst $R8 $R9 "$INSTDIR\*.erproj"
    stashErproj:
      StrCmp $R9 "" stashErprojDone
      CreateDirectory "$TEMP\edit-remote-erproj"
      CopyFiles /SILENT "$INSTDIR\$R9" "$TEMP\edit-remote-erproj"
      FindNext $R8 $R9
      Goto stashErproj
    stashErprojDone:
    FindClose $R8
    Pop $R9
    Pop $R8
  ${Else}
    RMDir /r "$TEMP\edit-remote-config"
    RMDir /r "$TEMP\edit-remote-erproj"
    Delete "$TEMP\edit-remote-config-location.json"
  ${EndIf}
!macroend

!macro customInstall
  CreateDirectory "$INSTDIR\config"
  nsExec::ExecToLog 'icacls "$INSTDIR\config" /grant *S-1-5-32-545:(OI)(CI)M'
  Pop $0
  nsExec::ExecToLog 'icacls "$INSTDIR" /grant *S-1-5-32-545:(WD,AD)'
  Pop $0
  ${If} ${FileExists} "$TEMP\edit-remote-config\*.*"
    CopyFiles /SILENT "$TEMP\edit-remote-config\*.*" "$INSTDIR\config"
    RMDir /r "$TEMP\edit-remote-config"
  ${EndIf}
  ${If} ${FileExists} "$TEMP\edit-remote-config-location.json"
    CopyFiles /SILENT "$TEMP\edit-remote-config-location.json" "$INSTDIR\config-location.json"
    Delete "$TEMP\edit-remote-config-location.json"
  ${EndIf}
  ${If} ${FileExists} "$TEMP\edit-remote-erproj\*.*"
    CopyFiles /SILENT "$TEMP\edit-remote-erproj\*.*" "$INSTDIR"
    RMDir /r "$TEMP\edit-remote-erproj"
  ${EndIf}
!macroend

; The uninstaller shipped with the previous version still deletes the whole
; install directory. This one removes the program files and leaves config and
; any project file. It runs on the upgrade after this setup is installed.
!macro customRemoveFiles
  SetOutPath $TEMP
  ${If} ${isUpdated}
    RMDir /r "$INSTDIR\locales"
    RMDir /r "$INSTDIR\resources"
    Delete "$INSTDIR\*.pak"
    Delete "$INSTDIR\*.dll"
    Delete "$INSTDIR\*.exe"
    Delete "$INSTDIR\*.bin"
    Delete "$INSTDIR\*.dat"
    Delete "$INSTDIR\*.ico"
    Delete "$INSTDIR\LICENSE*"
    Delete "$INSTDIR\LICENSES*"
    Delete "$INSTDIR\vk_swiftshader*"
    Delete "$INSTDIR\vk_swiftshader_icd.json"
    Delete "$INSTDIR\version"
  ${Else}
    RMDir /r "$INSTDIR"
  ${EndIf}
!macroend
