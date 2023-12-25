from pyscript import document
from js import get_editor_text
import sys
from io import StringIO


def print_to_terminal(event):
    input_text = get_editor_text()
    buffer = StringIO()
    sys.stdout = buffer
    exec(input_text)
    sys.stdout = sys.__stdout__
    output_div = document.querySelector("#output")
    output_div.innerText = buffer.getvalue()

