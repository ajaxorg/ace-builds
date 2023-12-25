from pluggy import HookimplMarker

from pyscript import app

register = HookimplMarker("pyscript")


def _add_cmd(f):
    app.command()(f)
