; EyedOptimizer — Instalador profesional (Inno Setup 6)
; Compilar con: ISCC.exe installer\EyedOptimizer.iss

#define MyAppName "EyedOptimizer"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "EyedOptimizer"
#define MyAppURL "https://eyedoptimizer.local"
#define MyAppExeName "EyedOptimizer.exe"

[Setup]
AppId={{A7E9C2B1-4D5F-4A8E-9C31-8F2B6D0E1A47}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=..\dist\installer
OutputBaseFilename=EyedOptimizer_Setup_{#MyAppVersion}
SetupIconFile=..\assets\icon.ico
WizardImageFile=..\assets\wizard.bmp
WizardSmallImageFile=..\assets\wizard-small.bmp
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=Instalador de EyedOptimizer
VersionInfoProductName={#MyAppName}
DisableProgramGroupPage=no
DisableWelcomePage=no
DisableDirPage=no
DisableReadyPage=no
AlwaysShowDirOnReadyPage=yes
AlwaysShowGroupOnReadyPage=yes
UsePreviousAppDir=yes
DirExistsWarning=auto
AllowRootDirectory=no
WizardSizePercent=125
SetupLogging=yes
ShowLanguageDialog=yes
InfoBeforeFile=
LicenseFile=

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
spanish.WelcomeLabel1=Bienvenido al instalador de EyedOptimizer
spanish.WelcomeLabel2=Este asistente le guiará en la instalación de EyedOptimizer en su equipo.%n%nPodrá elegir la carpeta de instalación, los accesos directos y las opciones de inicio.%n%nSe recomienda cerrar otras aplicaciones antes de continuar.
spanish.SelectDirLabel3=El programa se instalará en la siguiente carpeta. Puede elegir otra ruta pulsando Examinar.
spanish.SelectDirBrowseLabel=Para continuar, pulse Siguiente. Si desea seleccionar una carpeta distinta, pulse Examinar.
spanish.SelectTasksLabel2=Seleccione las tareas adicionales que desea realizar durante la instalación, y a continuación pulse Siguiente.
spanish.FinishedHeadingLabel=Instalación de EyedOptimizer completada
spanish.FinishedLabelNoIcons=EyedOptimizer se ha instalado correctamente en su equipo.
spanish.ClickFinish=Pulse Finalizar para cerrar el asistente.
english.WelcomeLabel1=Welcome to the EyedOptimizer Setup Wizard

[Types]
Name: "full"; Description: "Instalación completa (recomendada)"
Name: "compact"; Description: "Instalación compacta"
Name: "custom"; Description: "Instalación personalizada"; Flags: iscustom

[Components]
Name: "main"; Description: "EyedOptimizer (obligatorio)"; Types: full compact custom; Flags: fixed
Name: "docs"; Description: "Archivos de ayuda y README"; Types: full custom
Name: "assets"; Description: "Iconos y recursos visuales"; Types: full compact custom

[Tasks]
Name: "desktopicon"; Description: "Crear icono en el escritorio"; GroupDescription: "Iconos adicionales:"; Components: main; Flags: unchecked
Name: "startmenu"; Description: "Crear acceso en el menú Inicio"; GroupDescription: "Iconos adicionales:"; Components: main; Flags: checkedonce
Name: "autorun"; Description: "Iniciar EyedOptimizer con Windows"; GroupDescription: "Opciones de inicio:"; Components: main; Flags: unchecked
Name: "quickoptimize"; Description: "Abrir EyedOptimizer al terminar la instalación"; GroupDescription: "Después de instalar:"; Components: main; Flags: checkedonce

[Files]
Source: "..\dist\EyedOptimizer\EyedOptimizer.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: main
Source: "..\dist\EyedOptimizer\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: main
Source: "..\assets\icon.ico"; DestDir: "{app}\assets"; Flags: ignoreversion; Components: assets
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion; Components: docs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\assets\icon.ico"; Tasks: startmenu
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"; Tasks: startmenu
Name: "{group}\Leer README"; Filename: "{app}\README.md"; Tasks: startmenu; Components: docs
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\assets\icon.ico"; Tasks: desktopicon

[Registry]
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "EyedOptimizer"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue; Tasks: autorun
Root: HKLM; Subkey: "Software\EyedOptimizer"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\EyedOptimizer"; ValueType: string; ValueName: "Version"; ValueData: "{#MyAppVersion}"; Flags: uninsdeletekey

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Iniciar EyedOptimizer ahora"; Flags: nowait postinstall skipifsilent; Tasks: quickoptimize

[Code]
var
  OptionsPage: TInputOptionWizardPage;

function InitializeSetup(): Boolean;
begin
  Result := True;
end;

procedure InitializeWizard();
begin
  WizardForm.WelcomeLabel1.Caption := 'Bienvenido a EyedOptimizer';
  WizardForm.WelcomeLabel2.Caption :=
    'Este asistente instalará EyedOptimizer en su equipo.'#13#10#13#10 +
    'Podrá:'#13#10 +
    '  • Elegir la carpeta de instalación'#13#10 +
    '  • Seleccionar tipo de instalación (completa / compacta / personalizada)'#13#10 +
    '  • Crear iconos en escritorio y menú Inicio'#13#10 +
    '  • Activar inicio automático con Windows'#13#10#13#10 +
    'EyedOptimizer detecta la marca de su portátil o PC, el sistema operativo '#13#10 +
    'y le permite optimizar memoria y administrar procesos.';

  // Página extra de opciones rápidas
  OptionsPage := CreateInputOptionPage(
    wpSelectTasks,
    'Opciones rápidas',
    'Configure preferencias adicionales de EyedOptimizer',
    'Marque las opciones que desee aplicar:',
    True, False
  );
  OptionsPage.Add('Crear acceso directo adicional en la barra de tareas (manual tras instalar)');
  OptionsPage.Add('Mostrar consejo de ejecutar como administrador al primer inicio');
  OptionsPage.Values[0] := False;
  OptionsPage.Values[1] := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = wpSelectDir then
  begin
    if WizardDirValue = '' then
    begin
      MsgBox('Debe indicar una carpeta de instalación.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  TipsFile: String;
begin
  if CurStep = ssPostInstall then
  begin
    if OptionsPage.Values[1] then
    begin
      TipsFile := ExpandConstant('{app}\PRIMER_INICIO.txt');
      SaveStringToFile(
        TipsFile,
        'EyedOptimizer — Primer inicio'#13#10#13#10 +
        'Para liberar más memoria en procesos del sistema, haga clic derecho'#13#10 +
        'sobre EyedOptimizer y elija «Ejecutar como administrador».'#13#10#13#10 +
        'La aplicación detectará automáticamente la marca y modelo de su equipo,'#13#10 +
        'si es portátil o sobremesa, y la versión de Windows.'#13#10,
        False
      );
    end;
  end;
end;
