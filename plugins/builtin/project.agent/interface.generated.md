<!-- Generated from plugins/builtin/project.js; sha256 0a2b61a770ad564748732e05baf0251f8475da2255ac8a089363284424f52854. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/project.js). Where the prose below it disagrees, this is the code.

```
  plugin     Project Switcher
  category   editor
  points     1 panel, 1 menu
  commands   project.panel (Show the project panel)
             project.list (Which projects there are)
             project.open (Open a project by name or path)
             project.saveAs (Give the untitled project a name)
             project.close (Close the project — opens a fresh untitled one)
             project.switch (PROJECT)
  arguments  project.panel: none
  arguments  project.list: none
  arguments  project.open: said
  arguments  project.saveAs: said
  arguments  project.close: none
  arguments  project.switch: none
  listens    shell:ready
  source     312 lines
```
