try:
    from importlib import metadata  # type: ignore[import,unused-ignore]
except ImportError:
    # Python < 3.8
    import importlib_metadata as metadata  # type: ignore[no-redef,import-not-found]


click_version = metadata.version("click")
_major = int(click_version.split(".")[0])
_minor = int(click_version.split(".")[1])


CLICK_IS_BEFORE_VERSION_8X = _major < 8
CLICK_IS_BEFORE_VERSION_9X = _major < 9
CLICK_IS_VERSION_80 = _major == 8 and _minor == 0


if CLICK_IS_BEFORE_VERSION_8X:
    import warnings

    warnings.warn(
        "rich-click support for click 7.x is deprecated and will be removed soon."
        " Please upgrade click to a newer version.",
        DeprecationWarning,
    )
