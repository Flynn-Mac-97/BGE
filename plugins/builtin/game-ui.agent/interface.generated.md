<!--6b416e64-->
parsed from source
  plugin Game UI
  category game
  needs Screen, Heads Up Display, Keyboard Input
  commands gameui.read
  gameui.list
  gameui.controls
  gameui.click
  gameui.theme
  arguments gameui.read: id;gameui.list:;gameui.controls: id;gameui.click: { id, action, value, type };gameui.theme: name
  context gameUi
  systems fixed, frame
  listens hot:applied, level:loaded, play:stopped
  source 326 lines
