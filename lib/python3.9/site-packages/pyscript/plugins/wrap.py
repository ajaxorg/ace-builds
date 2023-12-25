import time
import webbrowser
from pathlib import Path
from typing import Optional

from pyscript import app, cli, console, plugins
from pyscript._generator import file_to_html, string_to_html

try:
    import rich_click.typer as typer
except ImportError:  # pragma: no cover
    import typer  # type: ignore


@app.command()
def wrap(
    input_file: Optional[Path] = typer.Argument(
        None,
        help="An optional path to the input .py script. If not provided, must use '-c' flag.",
    ),
    output: Optional[Path] = typer.Option(
        None,
        "-o",
        "--output",
        help="Path to the resulting HTML output file. Defaults to input_file with suffix replaced.",
    ),
    command: Optional[str] = typer.Option(
        None, "-c", "--command", help="If provided, embed a single command string."
    ),
    show: Optional[bool] = typer.Option(None, help="Open output file in web browser."),
    title: Optional[str] = typer.Option(None, help="Add title to HTML file."),
) -> None:
    """Wrap a Python script inside an HTML file."""
    title = title or "PyScript App"

    if not input_file and not command:
        raise cli.Abort(
            "Must provide either an input '.py' file or a command with the '-c' option."
        )
    if input_file and command:
        raise cli.Abort("Cannot provide both an input '.py' file and '-c' option.")

    # Derive the output path if it is not provided
    remove_output = False
    if output is None:
        if command and show:
            output = Path("pyscript_tmp.html")
            remove_output = True
        elif not command:
            assert input_file is not None
            output = input_file.with_suffix(".html")
        else:
            raise cli.Abort("Must provide an output file or use `--show` option")
    if input_file is not None:
        file_to_html(input_file, title, output)
    if command:
        string_to_html(command, title, output)
    if output:
        if show:
            console.print("Opening in web browser!")
            webbrowser.open(f"file://{output.resolve()}")
        if remove_output:
            time.sleep(1)
            output.unlink()


@plugins.register
def pyscript_subcommand():
    return wrap
