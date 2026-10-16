extends Node

signal finished
signal changed(value)
signal documented(value) # signal comment
signal resized(
    width: int
)

var apostrophe = "it's valid"
var triple = """A triple string can contain ' and " characters."""
var path = NodePath("Child's")
var child = get_node("Child's")
var shorthand = $"Child's"

var percent_format = "value: %04d"
var dotted_format = "{user.name}"
var indexed_format = "{user[0]}"
var nested_format = "{value:${width}}"

func typed(value: int = foo(1)) -> void:
    var continued = 1 + \
        2
    print(value, continued)

func multiline_parameter(
    value
):
    print(value)

var callback = func(value):
    return value
