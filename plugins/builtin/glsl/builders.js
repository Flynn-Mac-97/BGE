/**
 * The sample GLSL shaders.
 *
 * Three of the shelf's seven names are written here a second time, in GLSL, so
 * a swap can be seen: `shader.prefer glsl` and `gradient`, `hologram` and
 * `aura` are built from the source below instead of from the node graphs in
 * `shaders/builders.js`. The other four stay TSL and go on drawing, because
 * Shader Languages chooses per shader.
 *
 * `particle-colour` is a program rather than a material: the particle painter
 * owns the quad and asks only for the look of one particle.
 *
 * Defaults are imported from the shelf rather than repeated, so a swap changes
 * the language and nothing else. Every source is one function, and its
 * arguments are named in `inputs` — the list of what can be named is in
 * `bind.js`.
 *
 * Three is never imported: this file is strings.
 */

import { SHADERS } from '../shaders.js'

/**
 * Hash noise, used by more than one shader below. Cheap and deterministic.
 *
 * Helpers go above `#pragma main`. Three parses the first function it finds as
 * the shader itself, and the pragma is what says where the shader starts.
 */
const NOISE = `
  float hash(vec3 point) {
    return fract(sin(dot(point, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }
  float noise(vec3 point) {
    vec3 cell = floor(point);
    vec3 within = fract(point);
    within = within * within * (3.0 - 2.0 * within);
    float front = mix(mix(hash(cell), hash(cell + vec3(1, 0, 0)), within.x),
                      mix(hash(cell + vec3(0, 1, 0)), hash(cell + vec3(1, 1, 0)), within.x), within.y);
    float back = mix(mix(hash(cell + vec3(0, 0, 1)), hash(cell + vec3(1, 0, 1)), within.x),
                     mix(hash(cell + vec3(0, 1, 1)), hash(cell + vec3(1, 1, 1)), within.x), within.y);
    return mix(front, back, within.z);
  }
`

export const GLSL_SHADERS = {
  gradient: {
    parameters: SHADERS.gradient.parameters,
    inputs: {
      face: 'uv.face',
      screen: 'screen',
      from: 'colour:from',
      to: 'colour:to',
      mid: 'colour:mid',
      hasMid: 'declared:mid',
      angle: 'number:angle'
    },
    source: `
      vec4 gradient(vec2 face, vec2 screen, vec3 from, vec3 to, vec3 mid,
                    float hasMid, float angle) {
        float turned = radians(angle);
        float across = cos(turned);
        float along = sin(turned);
        // Scaled and offset so the ramp spans the whole face at any angle,
        // rather than only at right ones.
        float spread = max(abs(across) + abs(along), 0.0001);
        float start = (max(0.0, -across) + max(0.0, -along)) / spread;
        float ramped = clamp(face.x * across / spread + face.y * along / spread + start, 0.0, 1.0);
        float eased = smoothstep(0.0, 1.0, ramped);
        vec3 through = mix(mix(from, mid, clamp(eased * 2.0, 0.0, 1.0)),
                           to, clamp(eased * 2.0 - 1.0, 0.0, 1.0));
        vec3 colour = mix(mix(from, to, eased), through, hasMid);
        // A ramp across a face crosses far fewer than 256 steps of a channel,
        // so it bands. Under half a step of noise per pixel breaks the bands
        // up and is invisible on its own.
        float speckle = fract(sin(dot(screen, vec2(12.9898, 78.233))) * 43758.5453);
        return vec4(colour + (speckle - 0.5) / 255.0, 1.0);
      }`
  },

  hologram: {
    parameters: SHADERS.hologram.parameters,
    material: { transparent: true, depthWrite: false, blending: 'add' },
    inputs: {
      face: 'uv.face',
      clock: 'time',
      normal: 'normal',
      viewDirection: 'viewDirection',
      glow: 'colour:glow',
      lines: 'number:lines',
      speed: 'number:speed',
      flicker: 'number:flicker',
      glitch: 'number:glitch'
    },
    source: `${NOISE}
      #pragma main
      vec4 hologram(vec2 face, float clock, vec3 normal, vec3 viewDirection,
                    vec3 glow, float lines, float speed, float flicker, float glitch) {
        float row = floor(face.y * 26.0 + clock * 5.0);
        // Whole rows jump sideways for a moment. The hash is keyed on the row
        // and on the clock, so the same second always tears the same rows.
        // Hashed rather than smoothed: noise() interpolates between whole
        // numbers, so neighbouring rows would draw the same value and tear in
        // wide blocks instead of one row at a time.
        // The cut is 0.94 where the TSL version cuts at 0.62, because a hash
        // is flat across minus one to one and gradient noise concentrates near
        // zero. Both tear about one row in twenty.
        float jump = hash(vec3(row, floor(clock * 7.0), 0.0)) * 2.0 - 1.0;
        float torn = jump * step(0.94, abs(jump)) * glitch;
        vec2 point = vec2(face.x + torn, face.y);

        // Soft stripes, not hard ones. A hard step turns to moire the moment
        // the face is further away than its line spacing.
        float stripes = smoothstep(0.25, 0.75, fract(point.y * lines - clock * speed));
        float posts = smoothstep(0.7, 1.0, fract(point.x * max(1.0, lines * 0.25)));
        // A bright bar travelling up: what says the thing is projected.
        float fromMiddle = fract(point.y - clock * 0.23) - 0.5;
        float sweep = exp(fromMiddle * fromMiddle * -240.0);

        float border = min(min(point.x, 1.0 - point.x), min(point.y, 1.0 - point.y));
        float pixel = fwidth(border) + 0.0001;
        float line = 1.0 - smoothstep(0.02 - pixel, 0.02 + pixel, border);
        float rim = 1.0 - abs(dot(normalize(normal), normalize(viewDirection)));

        float wobble = sin(clock * 13.0) * flicker + 1.0;
        float strength = (stripes * 0.36 + posts * 0.07 + line * 0.9
                          + sweep * 0.55 + rim * 0.5) * wobble;
        // Alpha stays at 1: additive blending already multiplies by it, and a
        // second copy of the shape in there would square every soft edge.
        return vec4(mix(glow, vec3(1.0), sweep * 0.7) * strength, 1.0);
      }`
  },

  aura: {
    parameters: SHADERS.aura.parameters,
    material: { transparent: true, depthWrite: false, blending: 'add' },
    inputs: {
      face: 'uv.face',
      clock: 'time',
      glow: 'colour:glow',
      speed: 'number:speed',
      least: 'number:least',
      detail: 'number:detail',
      strength: 'number:strength'
    },
    source: `${NOISE}
      #pragma main
      vec4 aura(vec2 face, float clock, vec3 glow, float speed, float least,
                float detail, float strength) {
        vec2 middle = face - 0.5;
        // Soft from the middle of the face outward. A silhouette rim is zero
        // across a face pointed at the camera, which is how a sprite is set.
        float body = pow(1.0 - clamp(length(middle) * 2.0, 0.0, 1.0), 1.7);
        // Noise drifting on the clock breaks the disc into wisps. A disc with
        // no wisps reads as a lamp.
        float wisps = 0.0;
        float size = 1.0;
        float weight = 0.5;
        for (int octave = 0; octave < 4; octave++) {
          wisps += noise(vec3(middle * detail * size, clock * speed * 0.3)) * weight;
          size *= 2.0;
          weight *= 0.5;
        }
        float breath = (sin(clock * speed) * 0.5 + 0.5) * (1.0 - least) + least;
        float core = pow(body, 8.0);
        float alpha = clamp(body * mix(0.45, wisps, 0.75) + core, 0.0, 1.0) * breath;
        // White at the core, the glow colour outward. A hot centre is what
        // makes added light read as energy rather than a coloured smear.
        return vec4(mix(glow, vec3(1.0), core) * alpha * strength, 1.0);
      }`
  },

  edges: {
    parameters: SHADERS.edges.parameters,
    base: 'lambert',
    output: 'emissive',
    inputs: {
      face: 'uv.face',
      normal: 'normal',
      viewDirection: 'viewDirection',
      edge: 'colour:edge',
      width: 'number:width',
      power: 'number:power',
      strength: 'number:strength'
    },
    source: `
      vec3 edges(vec2 face, vec3 normal, vec3 viewDirection, vec3 edge,
                 float width, float power, float strength) {
        // Distance to the nearest face border: 0 at it, 0.5 in the middle.
        float border = min(min(face.x, 1.0 - face.x), min(face.y, 1.0 - face.y));
        // fwidth is how much that distance moves across one pixel, so a band
        // measured in those units is one pixel wide at any distance and never
        // thins out, fattens up, or aliases.
        float pixel = fwidth(border) + 0.0001;
        float line = 1.0 - smoothstep(width - pixel, width + pixel, border);
        float inward = pow(1.0 - smoothstep(0.0, width * 3.0, border), 2.2);
        float rim = 1.0 - abs(dot(normalize(normal), normalize(viewDirection)));
        // Brightest of three terms. The first two hold up on a flat face,
        // which a view-angle rim alone cannot.
        float glow = max(line, max(inward * 0.35, pow(rim, power) * 0.9));
        return edge * glow * strength;
      }`
  },

  waves: {
    parameters: SHADERS.waves.parameters,
    inputs: {
      metres: 'uv.metres',
      clock: 'time',
      shallow: 'colour:shallow',
      deep: 'colour:deep',
      foam: 'colour:foam',
      scale: 'number:scale',
      speed: 'number:speed',
      choppy: 'number:choppy',
      sparkle: 'number:sparkle'
    },
    source: `
      // Five waves crossing at different angles, lengths and speeds. The first
      // three give the shape and the last two the fine detail that tells a
      // surface from a sheet of satin. Held in one array so the height and both
      // slopes come out of one sum and the shading cannot drift out of step
      // with the shape it is shading.
      const vec4 WAVES[5] = vec4[5](
        vec4( 1.00,  0.22, 1.00, 1.00),
        vec4(-0.62,  1.00, 0.62, 0.83),
        vec4( 0.38, -0.86, 0.37, 1.37),
        vec4( 0.88,  0.72, 0.19, 1.70),
        vec4(-0.45, -0.95, 0.11, 2.20));
      const float SIZES[5] = float[5](0.70, 0.62, 0.44, 0.24, 0.13);
      const float WAVE_TOTAL = 2.13;
      // Where the water takes its light, and the halfway direction to the eye.
      // Fixed rather than read from the scene: this is a stylised surface, and
      // a sun that moved would drag every sparkle across it.
      const vec3 WATER_LIGHT = vec3(-0.3536, 0.4546, 0.8283);
      const vec3 WATER_HALF = vec3(-0.1845, 0.2373, 0.9596);
      #pragma main
      vec4 waves(vec2 metres, float clock, vec3 shallow, vec3 deep, vec3 foam,
                 float scale, float speed, float choppy, float sparkle) {
        float height = 0.0;
        float slopeAcross = 0.0;
        float slopeAlong = 0.0;
        for (int wave = 0; wave < 5; wave++) {
          float across = WAVES[wave].x;
          float along = WAVES[wave].y;
          float frequency = (6.2831853 * scale) / WAVES[wave].z;
          float phase = metres.x * across * frequency
                      + metres.y * along * frequency
                      + clock * speed * WAVES[wave].w;
          height += sin(phase) * SIZES[wave];
          // The slope leaves the frequency out, so raising scale adds waves
          // without also turning every one of them into a cliff.
          float slope = cos(phase) * SIZES[wave];
          slopeAcross += slope * across;
          slopeAlong += slope * along;
        }

        vec3 normal = normalize(vec3(slopeAcross * -choppy, slopeAlong * -choppy, 1.0));
        // Half lambert: the light wraps past the terminator rather than
        // stopping at it, so a trough goes dark instead of black. The power
        // pulls the midtones down, because water is mostly its deep colour.
        float lit = pow(dot(normal, WATER_LIGHT) * 0.5 + 0.5, 2.6);
        // A tight power on the halfway direction is the specular highlight,
        // and it turns a moving colour into a moving surface.
        float gloss = pow(clamp(dot(normal, WATER_HALF), 0.0, 1.0), 160.0) * sparkle * 1.6;
        // Only the tallest crests foam, in a narrow band, so the foam reads as
        // a line along a wave rather than a wash over the top of it.
        float crest = pow(smoothstep(0.68, 0.96, height / WAVE_TOTAL), 1.5);
        vec3 colour = mix(deep, shallow, lit) + foam * crest * 0.55 + vec3(gloss);
        return vec4(colour, 1.0);
      }`
  },

  dissolve: {
    parameters: SHADERS.dissolve.parameters,
    base: 'lambert',
    material: { transparent: true },
    // The noise is declared once and included by both slots. Both still
    // evaluate it, because they are two functions; only the declaration is
    // shared, and without that they would both declare `fractal` and fail.
    helpers: [NOISE, `
      float fractal(vec3 point) {
        float total = 0.0;
        float size = 1.0;
        float weight = 0.5;
        for (int octave = 0; octave < 2; octave++) {
          // Signed, then centred at the end. noise() is 0 to 1, so summing it
          // raw never reaches below half and nothing ever crosses the cut.
          total += (noise(point * size) * 2.0 - 1.0) * weight;
          size *= 2.0;
          weight *= 0.4;
        }
        return total * 0.5 + 0.5;
      }`],
    outputs: {
      // The body colour, with the burn carried as its alpha. One slot rather
      // than a separate opacity, because a node material reads the alpha of
      // its colour and `alphaTest` cuts on the same number.
      colour: {
        inputs: {
          local: 'position.local',
          tint: 'tint',
          body: 'colour:body',
          hasBody: 'declared:body',
          amount: 'number:amount',
          scale: 'number:scale'
        },
        source: `
          #pragma main
          vec4 dissolveColour(vec3 local, vec3 tint, vec3 body, float hasBody,
                              float amount, float scale) {
            float burned = fractal(local * scale);
            return vec4(mix(tint, body, hasBody), step(amount, burned));
          }`
      },
      // Two bands: a wide one in the edge colour and a thin white one at the
      // cut. The white band is what reads as burning rather than fading.
      emissive: {
        inputs: {
          local: 'position.local',
          edge: 'colour:edge',
          amount: 'number:amount',
          scale: 'number:scale',
          border: 'number:border',
          strength: 'number:strength'
        },
        source: `
          #pragma main
          vec3 dissolveEdge(vec3 local, vec3 edge, float amount, float scale,
                            float border, float strength) {
            float burned = fractal(local * scale);
            float burn = 1.0 - smoothstep(amount, amount + border, burned);
            float hot = 1.0 - smoothstep(amount, amount + border * 0.3, burned);
            return mix(edge, vec3(1.0), hot) * burn * strength;
          }`
      }
    }
  },

  grass: {
    parameters: SHADERS.grass.parameters,
    material: { side: 'double', alphaTest: 0.3 },
    helpers: [NOISE],
    outputs: {
      // Where the blades actually stand. Filling this slot replaces the
      // renderer's own projection, so the matrices arrive as arguments and the
      // clip-space position is worked out here.
      vertex: {
        inputs: {
          face: 'uv.face',
          world: 'position.world',
          eye: 'cameraPosition',
          projection: 'matrix.projection',
          view: 'matrix.view',
          clock: 'time',
          wide: 'quad.wide',
          tall: 'quad.tall',
          wind: 'number:wind',
          speed: 'number:speed'
        },
        source: `
          #pragma main
          vec4 grassVertex(vec2 face, vec3 world, vec3 eye, mat4 projection,
                           mat4 view, float clock, float wide, float tall,
                           float wind, float speed) {
            // The tuft's own centre, taken back out of the vertex. Reading the
            // object matrix would give the wrong answer the moment a field of
            // these is merged into one mesh, which happens as soon as they
            // stand still.
            vec3 centre = world - vec3((face.x - 0.5) * wide, (face.y - 0.5) * tall, 0.0);

            // Turned about Y only, so a tuft faces the camera and still stands.
            vec3 up = vec3(0.0, 1.0, 0.0);
            vec3 toEye = eye - centre;
            vec3 facing = normalize(vec3(toEye.x, 0.0001, toEye.z));
            vec3 across = normalize(cross(up, facing));

            // Two gusts at different rates, offset by where the tuft stands,
            // so a field never sways in one piece. Squared height holds the
            // roots still.
            float phase = centre.x * 0.7 + centre.z * 0.9;
            float gust = sin(clock * speed + phase)
                       + sin(clock * speed * 2.3 + phase * 1.7) * 0.35;
            float sway = gust * wind * tall * 0.3 * face.y * face.y;

            vec3 stood = centre
                       + across * ((face.x - 0.5) * wide + sway)
                       + up * ((face.y - 0.5) * tall);
            return projection * view * vec4(stood, 1.0);
          }`
      },
      // One blade per column of the face, each with its own height, tilt and
      // shade taken from the column number. A tuft of identical blades reads
      // as a comb. The blade's own shape is the alpha.
      colour: {
        inputs: {
          face: 'uv.face',
          root: 'colour:root',
          tip: 'colour:tip',
          blades: 'number:blades',
          lean: 'number:lean'
        },
        source: `
          #pragma main
          vec4 grassColour(vec2 face, vec3 root, vec3 tip, float blades, float lean) {
            float column = floor(face.x * blades);
            float within = fract(face.x * blades);
            float drawn = noise(vec3(column * 12.7, 4.2, 0.0));
            float top = drawn * 0.45 + 0.55;
            // The spine curves rather than leaning straight: a blade bends
            // more the further it is from the root.
            float spine = 0.5 + (drawn - 0.5) * lean * pow(face.y, 1.6);
            // A narrow base tapering steadily to a point. Too wide at the base
            // reads as a spike, too slow a taper as a flat stick.
            float halfWidth = pow(max(1.0 - face.y / top, 0.0), 0.7) * (drawn * 0.1 + 0.15);
            float soften = fwidth(within) + 0.001;
            float blade = (1.0 - smoothstep(halfWidth - soften, halfWidth + soften, abs(within - spine)))
                        * (1.0 - smoothstep(top - 0.03, top, face.y));
            // Darker where the blades crowd at the root. Without it a tuft is
            // a flat green shape rather than something with depth in it.
            float shade = smoothstep(0.0, 0.3, face.y) * 0.35 + 0.65;
            vec3 colour = mix(root, tip, pow(face.y, 0.8)) * (drawn * 0.3 + 0.82) * shade;
            return vec4(colour, 1.0);
          }`
      },
      // The blade's own shape, as opacity rather than as the colour's alpha.
      // `alphaTest` cuts on the opacity, so a tuft carrying its shape in the
      // colour draws an opaque black quad wherever a blade is not.
      opacity: {
        inputs: { face: 'uv.face', blades: 'number:blades', lean: 'number:lean' },
        source: `
          #pragma main
          float grassBlade(vec2 face, float blades, float lean) {
            float column = floor(face.x * blades);
            float within = fract(face.x * blades);
            float drawn = noise(vec3(column * 12.7, 4.2, 0.0));
            float top = drawn * 0.45 + 0.55;
            float spine = 0.5 + (drawn - 0.5) * lean * pow(face.y, 1.6);
            float halfWidth = pow(max(1.0 - face.y / top, 0.0), 0.7) * (drawn * 0.1 + 0.15);
            float soften = fwidth(within) + 0.001;
            return (1.0 - smoothstep(halfWidth - soften, halfWidth + soften, abs(within - spine)))
                 * (1.0 - smoothstep(top - 0.03, top, face.y));
          }`
      }
    }
  },

  'particle-colour': {
    kind: 'program',
    output: 'node',
    about: 'the look of one particle: the colour it was painted, times its texture, cut to a round edge where it has none',
    inputs: {
      surface: 'given:surface',
      painted: 'given:painted',
      sampled: 'given:sampled',
      textured: 'given:textured'
    },
    source: `
      vec4 particleColour(vec2 surface, vec4 painted, vec4 sampled, float textured) {
        // A soft round dot, so an untextured particle is a puff rather than a
        // square. A textured one takes its shape from the picture instead, or
        // the fade would eat the edge of the sprite.
        float edge = 1.0 - smoothstep(0.55, 1.0, length(surface - 0.5) * 2.0);
        vec4 tinted = painted * sampled;
        return vec4(tinted.rgb, tinted.a * mix(edge, 1.0, textured));
      }`
  }
}
