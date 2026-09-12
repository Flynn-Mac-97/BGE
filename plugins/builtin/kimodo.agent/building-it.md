# Building it

- **The build is CPU only and builds `kmd-generate` alone.** Vulkan needs the
  SDK, and the test targets link the Vulkan library whether or not it was built.
  `--vulkan` turns the backend back on.
- **Windows needs Visual Studio 2022 with the C++ tools.** `cl.exe` is not on
  PATH until `vcvars64.bat` has run, so every cmake call goes through it. The
  installer finds it with vswhere and refuses early if it is not there.
- **Upstream does not compile with MSVC.** `tools/kimodo-windows.patch` fixes
  four places: two missing `<stdexcept>` includes, a `std::filesystem::path`
  passed where a `const char *` is wanted, and a Vulkan call outside the guard
  that decides whether Vulkan was built. `--install` applies it.
- ggml's shared libraries are written to `build/release/bin`, not beside the
  binary, so it will not start without that directory on PATH.
  `make-rig-clip.mjs` puts it there.
