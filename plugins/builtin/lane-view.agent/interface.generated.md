<!-- Generated from plugins/builtin/lane-view.js; sha256 6e58ebfd691b5e50c4a7156058bb2e85ca8396ac62ed711ee5359deeeee95d39. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/lane-view.js). Where the prose below it disagrees, this is the code.

```
  plugin     Lane View
  category   agents
  needs      Terminal Bridge
  points     1 panel, 1 menu
  commands   lane.view (Open or close the lane viewer)
             lane.watch (Watch one lane by client name — the only lane polled)
             lane.report (What the lane viewer is showing, and when each half was taken)
             lane-view (LANES)
  arguments  lane.view: none
  arguments  lane.watch: name
  arguments  lane.report: none
  arguments  lane-view: none
  source     399 lines
```
