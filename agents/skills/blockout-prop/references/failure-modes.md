# How AI prop blockouts fail

The seven, with the evidence. `SKILL.md` carries the one-line index and
repeats each rule at the point where it bites; this file is why each one is
on the list. Ordered by damage. 1 and 2 got a build scored **0.4 / 10** by a
working artist.

## 1. Everything is a cube

A grip is a tapered canted column; a barrel is a revolve; a fairing is a
loft. Ask of every part: what shape is the real thing? A cylinder with little
cubes glued round it is the same failure.

A cube needs a written reason. A crate is a cube. A shipping container is a
cube. Almost nothing else is. A build that is mostly cubes has described
bounding boxes rather than forms, and it will score near zero.

## 2. Placed without regard to use or assembly

A washing-machine door faces the aisle; a trigger sits under a finger, inside
its guard. For every part, say who touches it and from where, then check it
faces them.

## 3. Screws on seams

A working artist found screw holes overlapping each other, and screws sitting
exactly on the seam between two panels. A screw holds **one** piece: it sits
inside that piece's outline, inset from the edge, on a regular pitch, never
on a joint. A seam gets a gap or a step, not a fastener. Before you place any
repeated fixture, say what it attaches, to what, and where the joint is - and
make it a check the build refuses to render past, not a thing you remember.

## 4. Floating, sunk, interpenetrating

Parts touching nothing, a module inside the body, a cable through a panel -
all survived five passes and a rubric, because no render shows it. Check
numbers, not pictures.

## 5. Named, not shown

If you could not identify the part from the render with the name list hidden,
it is a grey box with a caption.

## 6. Review images that show nothing

A camera jammed against a near object renders a clean, useless picture and
will not say so. If you cannot name what a frame shows, the camera is wrong,
not the model.

## 7. Trusting your own score

Three builds scored by the agent, then blind by the artist: 6.3 vs 0.4,
7.6 vs 6.1, 6.6 vs 3.9. The order was right every time; the numbers were
1.5-6 high. Score to rank passes against each other, never as a pass mark.

## The cost evidence behind the build rules

One parameterised script re-run every pass costs 76 tokens of context per
part. Patching a live scene object by object costs 681. Every turn re-reads
your whole context, so the real cost is turns times context - which is why
`SKILL.md` asks for one script rewritten whole per pass, one Blender run per
pass, and one review sheet per pass rather than every render.

## The builds that skipped Stop

Builds made from memory rather than from the photograph in front of them
scored 0.4, 3.9 and 6.1 out of 10. The two disasters failed on things a
photograph answers for free.
