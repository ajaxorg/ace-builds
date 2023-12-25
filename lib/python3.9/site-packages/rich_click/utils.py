from typing import Any, Optional


def truthy(o: Any) -> Optional[bool]:
    """Check if string or other obj is truthy."""
    if isinstance(o, str):
        if o.lower() in {"y", "yes", "t", "true", "1"}:
            return True
        elif o.lower() in {"n", "no", "f", "false", "0"}:
            return False
        else:
            return None
    elif o is None:
        return None
    else:
        return bool(o)
