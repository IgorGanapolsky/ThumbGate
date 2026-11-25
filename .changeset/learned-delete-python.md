---
"thumbgate": patch
---

A delete command ThumbGate has learned and denied (rm, rmdir, unlink) now also denies the same literal path when it is deleted through a Python call (shutil.rmtree, os.remove, os.unlink, os.rmdir, Path.unlink, Path.rmdir, or rm run from subprocess or os.system), whether in a `python -c` command, a heredoc script or a .py file being written. It does not cover paths built at run time, scripts the gate cannot read, parent directories, or other languages.
