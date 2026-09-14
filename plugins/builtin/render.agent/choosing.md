# Choosing render settings

## Why the 3D defaults are what they are

They were chosen by comparing frames of one textured interior (a bed with
fabric, knit and oak textures) under the level's own ambient and sun:

| tried | result |
|---|---|
| no tone mapping, no environment | dark, flat, walls unlit |
| agx, room environment 0.6, exposure 1 | washed out and grey |
| agx, exposure 0.7 | still grey; agx pales colour |
| **neutral, exposure 0.9, environment 0.4** | texture colours kept, walls lit, soft contact shadows |

Judge a new game's look on its own frames. These defaults are a start.

## Tone mapping

| option | reads as |
|---|---|
| `neutral` | colours close to the textures; highlights roll off gently |
| `agx` | Blender's default; paler, very soft highlights |
| `aces` | film contrast, warmer, darker shadows |
| `reinhard` | soft, low contrast |
| `none` | the value in the texture is the pixel. Right for 2D |

Changing tone mapping recompiles every material once.

## Environment

- `room` is three's RoomEnvironment: a grey studio box, filtered once.
- A path lights from an equirectangular HDR photo, such as a free one from Poly
  Haven. Put it in `assets/` and name it.
- The environment lights surfaces only. The picture behind the level is the
  Skybox plugin's.

## Shadows

| option | three shadow type | edge |
|---|---|---|
| `soft` | VSM, radius 4 | blurred, no grain |
| `smooth` | VSM, radius 9 | wider blur |
| `sharp` | PCF, radius 1 | crisp; cheapest |

The node renderer's PCF takes five rotated samples, so a wide PCF radius shows as
grain along the edge; soft edges use variance maps instead, which blur the map
once per frame. A very thin object can let light through a variance map. Each
step up in `shadowSize` costs four times the memory.

## Backend

`webgpu` is the default. Three falls back to WebGL by itself where a browser has
no WebGPU. Choose `webgl` only for a shader written in GLSL alone: GLSL builds on
WebGL only, and a shader also written in TSL draws on either. The choice is read
at the next page load; `render.look` reports what is drawing now and whether a
reload is needed.
