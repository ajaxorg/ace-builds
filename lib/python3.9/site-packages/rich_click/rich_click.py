import inspect
import re
from typing import Dict, Iterable, List, Optional, Tuple, TYPE_CHECKING, Union

import click
import rich.columns
import rich.markdown
import rich.text

# Due to how rich_click.cli.patch() works, it is safer to import Command types directly
# rather than use the click module e.g. click.Command
from click import Command, Group
from rich import box
from rich.align import Align
from rich.columns import Columns
from rich.emoji import Emoji
from rich.highlighter import RegexHighlighter
from rich.markdown import Markdown
from rich.padding import Padding
from rich.panel import Panel
from rich.style import StyleType
from rich.table import Table
from rich.text import Text
from typing_extensions import Literal

from rich_click._compat_click import CLICK_IS_BEFORE_VERSION_8X, CLICK_IS_BEFORE_VERSION_9X, CLICK_IS_VERSION_80
from rich_click.rich_help_configuration import (
    force_terminal_default,
    OptionHighlighter,
    RichHelpConfiguration,
    terminal_width_default,
)
from rich_click.rich_help_formatter import RichHelpFormatter

# Support rich <= 10.6.0
try:
    from rich.console import group
except ImportError:
    from rich.console import render_group as group  # type: ignore[attr-defined,no-redef]


if CLICK_IS_BEFORE_VERSION_9X:
    from click import MultiCommand
else:
    MultiCommand = Group  # type: ignore[misc,assignment]


# Default styles
STYLE_OPTION: rich.style.StyleType = "bold cyan"
STYLE_ARGUMENT: rich.style.StyleType = "bold cyan"
STYLE_COMMAND: rich.style.StyleType = "bold cyan"
STYLE_SWITCH: rich.style.StyleType = "bold green"
STYLE_METAVAR: rich.style.StyleType = "bold yellow"
STYLE_METAVAR_APPEND: rich.style.StyleType = "dim yellow"
STYLE_METAVAR_SEPARATOR: rich.style.StyleType = "dim"
STYLE_HEADER_TEXT: rich.style.StyleType = ""
STYLE_EPILOG_TEXT: rich.style.StyleType = ""
STYLE_FOOTER_TEXT: rich.style.StyleType = ""
STYLE_USAGE: rich.style.StyleType = "yellow"
STYLE_USAGE_COMMAND: rich.style.StyleType = "bold"
STYLE_DEPRECATED: rich.style.StyleType = "red"
STYLE_HELPTEXT_FIRST_LINE: rich.style.StyleType = ""
STYLE_HELPTEXT: rich.style.StyleType = "dim"
STYLE_OPTION_HELP: rich.style.StyleType = ""
STYLE_OPTION_DEFAULT: rich.style.StyleType = "dim"
STYLE_OPTION_ENVVAR: rich.style.StyleType = "dim yellow"
STYLE_REQUIRED_SHORT: rich.style.StyleType = "red"
STYLE_REQUIRED_LONG: rich.style.StyleType = "dim red"
STYLE_OPTIONS_PANEL_BORDER: rich.style.StyleType = "dim"
ALIGN_OPTIONS_PANEL: rich.align.AlignMethod = "left"
STYLE_OPTIONS_TABLE_SHOW_LINES: bool = False
STYLE_OPTIONS_TABLE_LEADING: int = 0
STYLE_OPTIONS_TABLE_PAD_EDGE: bool = False
STYLE_OPTIONS_TABLE_PADDING: rich.padding.PaddingDimensions = (0, 1)
STYLE_OPTIONS_TABLE_BOX: rich.style.StyleType = ""
STYLE_OPTIONS_TABLE_ROW_STYLES: Optional[List[rich.style.StyleType]] = None
STYLE_OPTIONS_TABLE_BORDER_STYLE: Optional[rich.style.StyleType] = None
STYLE_COMMANDS_PANEL_BORDER: rich.style.StyleType = "dim"
ALIGN_COMMANDS_PANEL: rich.align.AlignMethod = "left"
STYLE_COMMANDS_TABLE_SHOW_LINES: bool = False
STYLE_COMMANDS_TABLE_LEADING: int = 0
STYLE_COMMANDS_TABLE_PAD_EDGE: bool = False
STYLE_COMMANDS_TABLE_PADDING: rich.padding.PaddingDimensions = (0, 1)
STYLE_COMMANDS_TABLE_BOX: rich.style.StyleType = ""
STYLE_COMMANDS_TABLE_ROW_STYLES: Optional[List[rich.style.StyleType]] = None
STYLE_COMMANDS_TABLE_BORDER_STYLE: Optional[rich.style.StyleType] = None
STYLE_COMMANDS_TABLE_COLUMN_WIDTH_RATIO: Optional[Union[Tuple[None, None], Tuple[int, int]]] = (None, None)
STYLE_ERRORS_PANEL_BORDER: rich.style.StyleType = "red"
ALIGN_ERRORS_PANEL: rich.align.AlignMethod = "left"
STYLE_ERRORS_SUGGESTION: rich.style.StyleType = "dim"
STYLE_ERRORS_SUGGESTION_COMMAND: rich.style.StyleType = "blue"
STYLE_ABORTED: rich.style.StyleType = "red"
WIDTH: Optional[int] = terminal_width_default()
MAX_WIDTH: Optional[int] = terminal_width_default()
COLOR_SYSTEM: Optional[
    Literal["auto", "standard", "256", "truecolor", "windows"]
] = "auto"  # Set to None to disable colors
FORCE_TERMINAL: Optional[bool] = force_terminal_default()

# Fixed strings
HEADER_TEXT: Optional[str] = None
FOOTER_TEXT: Optional[str] = None
DEPRECATED_STRING: str = "(Deprecated) "
DEFAULT_STRING: str = "[default: {}]"
ENVVAR_STRING: str = "[env var: {}]"
REQUIRED_SHORT_STRING: str = "*"
REQUIRED_LONG_STRING: str = "[required]"
RANGE_STRING: str = " [{}]"
APPEND_METAVARS_HELP_STRING: str = "({})"
ARGUMENTS_PANEL_TITLE: str = "Arguments"
OPTIONS_PANEL_TITLE: str = "Options"
COMMANDS_PANEL_TITLE: str = "Commands"
ERRORS_PANEL_TITLE: str = "Error"
ERRORS_SUGGESTION: Optional[str] = None  # Default: Try 'cmd -h' for help. Set to False to disable.
ERRORS_EPILOGUE: Optional[str] = None
ABORTED_TEXT: str = "Aborted."

# Behaviours
SHOW_ARGUMENTS: bool = False  # Show positional arguments
SHOW_METAVARS_COLUMN: bool = True  # Show a column with the option metavar (eg. INTEGER)
APPEND_METAVARS_HELP: bool = False  # Append metavar (eg. [TEXT]) after the help text
GROUP_ARGUMENTS_OPTIONS: bool = False  # Show arguments with options instead of in own panel
OPTION_ENVVAR_FIRST: bool = False  # Show env vars before option help text instead of avert
USE_MARKDOWN: bool = False  # Parse help strings as markdown
USE_MARKDOWN_EMOJI: bool = True  # Parse emoji codes in markdown :smile:
USE_RICH_MARKUP: bool = False  # Parse help strings for rich markup (eg. [red]my text[/])
# Define sorted groups of panels to display subcommands
COMMAND_GROUPS: Dict[str, List[Dict[str, Union[str, List[str]]]]] = {}
# Define sorted groups of panels to display options and arguments
OPTION_GROUPS: Dict[str, List[Dict[str, Union[str, List[str], Dict[str, List[str]]]]]] = {}
USE_CLICK_SHORT_HELP: bool = False  # Use click's default function to truncate help text

highlighter: rich.highlighter.Highlighter = OptionHighlighter()
_formatter: Optional[RichHelpFormatter] = None


def _get_rich_formatter(formatter: Optional[click.HelpFormatter] = None) -> RichHelpFormatter:
    """Get Rich Help Formatter.

    Resolves the rich help formatter from the following:
        - formatter, if exists and is a `RichHelpFormatter` object
        - cached, module-level formatter
        - active click Context, that is cached as module-level attr
        - module-level settings (default)

    Args:
        formatter: A possible Rich help formatter
    """
    if formatter and isinstance(formatter, RichHelpFormatter):
        return formatter

    global _formatter
    if _formatter:
        return _formatter
    ctx = click.get_current_context(True)
    if ctx:
        formatter = ctx.make_formatter()
        if isinstance(formatter, RichHelpFormatter):
            _formatter = formatter
            return _formatter

    _formatter = RichHelpFormatter(config=get_module_help_configuration())
    return _formatter


def _make_rich_rext(
    text: str, style: StyleType = "", formatter: Optional[RichHelpFormatter] = None
) -> Union[rich.markdown.Markdown, Text]:
    """Take a string, remove indentations, and return styled text.

    By default, return the text as a Rich Text with the request style.
    If config.use_rich_markup is True, also parse the text for Rich markup strings.
    If config.use_markdown is True, parse as Markdown.

    Only one of config.use_markdown or config.use_rich_markup can be True.
    If both are True, config.use_markdown takes precedence.

    Args:
        text (str): Text to style
        style (str): Rich style to apply

    Returns:
        MarkdownElement or Text: Styled text object
    """
    formatter = _get_rich_formatter(formatter)
    config = formatter.config
    # Remove indentations from input text
    text = inspect.cleandoc(text)
    if config.use_markdown:
        if config.use_markdown_emoji:
            text = Emoji.replace(text)
        return Markdown(text, style=style)
    if config.use_rich_markup:
        return config.highlighter(Text.from_markup(text, style=style))
    else:
        return config.highlighter(Text(text, style=style))


@group()
def _get_help_text(
    obj: Union[Command, Group], formatter: Optional[RichHelpFormatter] = None
) -> Iterable[Union[rich.markdown.Markdown, rich.text.Text]]:
    """Build primary help text for a click command or group.

    Returns the prose help text for a command or group, rendered either as a
    Rich Text object or as Markdown.
    If the command is marked as depreciated, the depreciated string will be prepended.

    Args:
        obj (click.Command or click.Group): Command or group to build help text for

    Yields:
        Text or Markdown: Multiple styled objects (depreciated, usage)
    """
    if TYPE_CHECKING:
        assert isinstance(obj.help, str)
    formatter = _get_rich_formatter(formatter)
    config = formatter.config
    # Prepend deprecated status
    if obj.deprecated:
        yield Text(config.deprecated_string, style=config.style_deprecated)

    # Fetch and dedent the help text
    help_text = inspect.cleandoc(obj.help)

    # Trim off anything that comes after \f on its own line
    help_text = help_text.partition("\f")[0]

    # Get the first paragraph
    first_line = help_text.split("\n\n")[0]
    # Remove single linebreaks
    if not config.use_markdown and not first_line.startswith("\b"):
        first_line = first_line.replace("\n", " ")
    yield _make_rich_rext(first_line.strip(), config.style_helptext_first_line, formatter)

    # Get remaining lines, remove single line breaks and format as dim
    remaining_paragraphs = help_text.split("\n\n")[1:]
    if len(remaining_paragraphs) > 0:
        if not config.use_markdown:
            # Remove single linebreaks
            remaining_paragraphs = [
                x.replace("\n", " ").strip() if not x.startswith("\b") else "{}\n".format(x.strip("\b\n"))
                for x in remaining_paragraphs
            ]
            # Join back together
            remaining_lines = "\n".join(remaining_paragraphs)
        else:
            # Join with double linebreaks if markdown
            remaining_lines = "\n\n".join(remaining_paragraphs)

        yield _make_rich_rext(remaining_lines, config.style_helptext, formatter)


def _get_option_help(
    param: Union[click.Argument, click.Option], ctx: click.Context, formatter: Optional[RichHelpFormatter] = None
) -> rich.columns.Columns:
    """Build primary help text for a click option or argument.

    Returns the prose help text for an option or argument, rendered either
    as a Rich Text object or as Markdown.
    Additional elements are appended to show the default and required status if applicable.

    Args:
        param (click.Argument or click.Option): Parameter to build help text for
        ctx (click.Context): Click Context object

    Returns:
        Columns: A columns element with multiple styled objects (help, default, required)
    """
    formatter = _get_rich_formatter(formatter)
    config = formatter.config
    items: List[rich.console.RenderableType] = []

    if TYPE_CHECKING:
        assert isinstance(param.name, str)

    # Get the environment variable first
    envvar = getattr(param, "envvar", None)
    # https://github.com/pallets/click/blob/0aec1168ac591e159baf6f61026d6ae322c53aaf/src/click/core.py#L2720-L2726
    if envvar is None:
        if (
            getattr(param, "allow_from_autoenv", None)
            and getattr(ctx, "auto_envvar_prefix", None) is not None
            and param.name is not None
        ):
            envvar = f"{ctx.auto_envvar_prefix}_{param.name.upper()}"
    if envvar is not None:
        envvar = ", ".join(envvar) if type(envvar) is list else envvar

    # Environment variable config.before help text
    if getattr(param, "show_envvar", None) and config.option_envvar_first and envvar is not None:
        items.append(Text(config.envvar_string.format(envvar), style=config.style_option_envvar))

    # Main help text
    if getattr(param, "help", None):
        if TYPE_CHECKING:
            assert isinstance(param, click.Option)
            assert hasattr(param, "help")
            assert isinstance(param.help, str)
        paragraphs = param.help.split("\n\n")
        # Remove single linebreaks
        if not config.use_markdown:
            paragraphs = [
                x.replace("\n", " ").strip() if not x.startswith("\b") else "{}\n".format(x.strip("\b\n"))
                for x in paragraphs
            ]
        items.append(_make_rich_rext("\n".join(paragraphs).strip(), config.style_option_help, formatter))

    # Append metavar if requested
    if config.append_metavars_help:
        metavar_str = param.make_metavar()
        # Do it ourselves if this is a positional argument
        if isinstance(param, click.core.Argument) and re.match(rf"\[?{param.name.upper()}]?", metavar_str):
            metavar_str = param.type.name.upper()
        # Attach metavar if param is a positional argument, or if it is a non boolean and non flag option
        if isinstance(param, click.core.Argument) or (metavar_str != "BOOLEAN" and not param.is_flag):
            metavar_str = metavar_str.replace("[", "").replace("]", "")
            items.append(
                Text(
                    config.append_metavars_help_string.format(metavar_str),
                    style=config.style_metavar_append,
                    overflow="fold",
                )
            )

    # Environment variable config.after help text
    if getattr(param, "show_envvar", None) and not config.option_envvar_first and envvar is not None:
        items.append(Text(config.envvar_string.format(envvar), style=config.style_option_envvar))

    # Default value
    # Click 7.x, 8.0, and 8.1 all behave slightly differently when handling the default value help text.
    if not hasattr(param, "show_default"):
        parse_default = False
    elif CLICK_IS_BEFORE_VERSION_8X:
        parse_default = bool(param.default is not None and (param.show_default or getattr(ctx, "show_default", None)))
    elif CLICK_IS_VERSION_80:
        show_default_is_str = isinstance(param.show_default, str)
        parse_default = bool(
            show_default_is_str or (param.default is not None and (param.show_default or ctx.show_default))
        )
    else:
        show_default_is_str = False
        if param.show_default is not None:
            if isinstance(param.show_default, str):
                show_default_is_str = show_default = True
            else:
                show_default = bool(param.show_default)
        else:
            show_default = bool(getattr(ctx, "show_default", False))
        parse_default = bool(show_default_is_str or (show_default and (param.default is not None)))

    if parse_default:
        help_record = param.get_help_record(ctx)
        if TYPE_CHECKING:
            assert isinstance(help_record, tuple)
        default_str_match = re.search(r"\[(?:.+; )?default: (.*)\]", help_record[-1])
        if default_str_match:
            # Don't show the required string, as we show that afterwards anyway
            default_str = default_str_match.group(1).replace("; required", "")
            items.append(
                Text(
                    config.default_string.format(default_str),
                    style=config.style_option_default,
                )
            )

    # Required?
    if param.required:
        items.append(Text(config.required_long_string, style=config.style_required_long))

    # Use Columns - this allows us to group different renderable types
    # (Text, Markdown) onto a single line.
    return Columns(items)


def _make_command_help(
    help_text: str, formatter: Optional[RichHelpFormatter] = None
) -> Union[rich.text.Text, rich.markdown.Markdown]:
    """Build cli help text for a click group command.

    That is, when calling help on groups with multiple subcommands
    (not the main help text when calling the subcommand help).

    Returns the first paragraph of help text for a command, rendered either as a
    Rich Text object or as Markdown.
    Ignores single newlines as paragraph markers, looks for double only.

    Args:
        help_text (str): Help text

    Returns:
        Text or Markdown: Styled object
    """
    formatter = _get_rich_formatter(formatter)
    config = formatter.config
    paragraphs = inspect.cleandoc(help_text).split("\n\n")
    # Remove single linebreaks
    if not config.use_markdown and not paragraphs[0].startswith("\b"):
        paragraphs[0] = paragraphs[0].replace("\n", " ")
    elif paragraphs[0].startswith("\b"):
        paragraphs[0] = paragraphs[0].replace("\b\n", "")

    return _make_rich_rext(paragraphs[0].strip(), config.style_option_help, formatter)


def get_rich_usage(
    obj: Union[Command, Group],
    ctx: click.Context,
    formatter: click.HelpFormatter,
) -> None:
    """Get usage text for a command."""
    formatter = _get_rich_formatter(formatter)
    config = formatter.config
    console = formatter.console

    # Highlighter for options and arguments
    class UsageHighlighter(RegexHighlighter):
        highlights = [
            r"(?P<argument>\w+)",
        ]

    usage_highlighter = UsageHighlighter()

    # Print usage
    console.print(
        Padding(
            Columns(
                (
                    Text("Usage:", style=config.style_usage),
                    Text(ctx.command_path, style=config.style_usage_command),
                    usage_highlighter(" ".join(obj.collect_usage_pieces(ctx))),
                )
            ),
            1,
        ),
    )


def rich_format_help(
    obj: Command,
    ctx: click.Context,
    formatter: click.HelpFormatter,
) -> None:
    """Print nicely formatted help text using rich.

    Based on original code from rich-cli, by @willmcgugan.
    https://github.com/Textualize/rich-cli/blob/8a2767c7a340715fc6fbf4930ace717b9b2fc5e5/src/rich_cli/__main__.py#L162-L236

    Replacement for the click function format_help().
    Takes a command or group and builds the help text output.

    Args:
        obj (click.Command or click.Group): Command or group to build help text for
        ctx (click.Context): Click Context object
        formatter (click.HelpFormatter): Click HelpFormatter object
    """
    formatter = _get_rich_formatter(formatter)
    config = formatter.config
    console = formatter.console
    highlighter = formatter.config.highlighter

    # Header text if we have it
    if config.header_text:
        console.print(
            Padding(
                _make_rich_rext(config.header_text, config.style_header_text, formatter),
                (1, 1, 0, 1),
            ),
        )

    # Print usage
    get_rich_usage(obj, ctx, formatter)

    # Print command / group help if we have some
    if obj.help:
        # Print with some padding
        console.print(
            Padding(
                Align(_get_help_text(obj, formatter), pad=False),
                (0, 1, 1, 1),
            )
        )

    # Look through config.option_groups for this command
    # stick anything unmatched into a default group at the end
    option_groups = config.option_groups.get(ctx.command_path, []).copy()
    option_groups.append({"options": []})
    argument_group_options = []

    for param in obj.get_params(ctx):
        # Skip positional arguments - they don't have opts or helptext and are covered in usage
        # See https://click.palletsprojects.com/en/8.0.x/documentation/#documenting-arguments
        if isinstance(param, click.core.Argument) and not config.show_arguments:
            continue

        # Skip if option is hidden
        if getattr(param, "hidden", False):
            continue

        # Already mentioned in a config option group
        for option_group in option_groups:
            if any([opt in option_group.get("options", []) for opt in param.opts]):
                break

        # No break, no mention - add to the default group
        else:
            if isinstance(param, click.core.Argument) and not config.group_arguments_options:
                argument_group_options.append(param.opts[0])
            else:
                list_of_option_groups: List[str] = option_groups[-1]["options"]  # type: ignore[assignment]
                list_of_option_groups.append(param.opts[0])

    # If we're not grouping arguments and we got some, prepend before default options
    if len(argument_group_options) > 0:
        extra_option_group = {"name": config.arguments_panel_title, "options": argument_group_options}
        option_groups.insert(len(option_groups) - 1, extra_option_group)

    # print("!", option_groups)

    # Print each option group panel
    for option_group in option_groups:
        options_rows = []
        for opt in option_group.get("options", []):
            # Get the param
            for param in obj.get_params(ctx):
                if any([opt in param.opts]):
                    break
            # Skip if option is not listed in this group
            else:
                continue

            # Short and long form
            opt_long_strs = []
            opt_short_strs = []
            for idx, opt in enumerate(param.opts):
                opt_str = opt
                try:
                    opt_str += "/" + param.secondary_opts[idx]
                except IndexError:
                    pass

                if isinstance(param, click.core.Argument):
                    opt_long_strs.append(opt_str.upper())
                elif "--" in opt:
                    opt_long_strs.append(opt_str)
                else:
                    opt_short_strs.append(opt_str)

            # Column for a metavar, if we have one
            metavar = Text(style=config.style_metavar, overflow="fold")
            metavar_str = param.make_metavar()

            if TYPE_CHECKING:
                assert isinstance(param.name, str)
                assert isinstance(param, click.Option)

            # Do it ourselves if this is a positional argument
            if isinstance(param, click.core.Argument) and re.match(rf"\[?{param.name.upper()}]?", metavar_str):
                metavar_str = param.type.name.upper()

            # Attach metavar if param is a positional argument, or if it is a non boolean and non flag option
            if isinstance(param, click.core.Argument) or (
                metavar_str != "BOOLEAN" and not getattr(param, "is_flag", None)
            ):
                metavar.append(metavar_str)

            # Range - from
            # https://github.com/pallets/click/blob/c63c70dabd3f86ca68678b4f00951f78f52d0270/src/click/core.py#L2698-L2706  # noqa: E501
            try:
                # skip count with default range type
                if isinstance(param.type, click.types._NumberRangeBase) and not (
                    param.count and param.type.min == 0 and param.type.max is None
                ):
                    range_str = param.type._describe_range()
                    if range_str:
                        metavar.append(config.range_string.format(range_str))
            except AttributeError:
                # click.types._NumberRangeBase is only in Click 8x onwards
                pass

            # Required asterisk
            required: Union[Text, str] = ""
            if param.required:
                required = Text(config.required_short_string, style=config.style_required_short)

            # Highlighter to make [ | ] and <> dim
            class MetavarHighlighter(RegexHighlighter):
                highlights = [
                    r"^(?P<metavar_sep>(\[|<))",
                    r"(?P<metavar_sep>\|)",
                    r"(?P<metavar_sep>(\]|>)$)",
                ]

            metavar_highlighter = MetavarHighlighter()

            rows = [
                required,
                highlighter(highlighter(",".join(opt_long_strs))),
                highlighter(highlighter(",".join(opt_short_strs))),
                metavar_highlighter(metavar),
                _get_option_help(param, ctx, formatter),
            ]

            # Remove metavar if specified in config
            if not config.show_metavars_column:
                rows.pop(3)

            options_rows.append(rows)

        if len(options_rows) > 0:
            t_styles = {
                "show_lines": config.style_options_table_show_lines,
                "leading": config.style_options_table_leading,
                "box": config.style_options_table_box,
                "border_style": config.style_options_table_border_style,
                "row_styles": config.style_options_table_row_styles,
                "pad_edge": config.style_options_table_pad_edge,
                "padding": config.style_options_table_padding,
            }
            t_styles.update(option_group.get("table_styles", {}))  # type: ignore[arg-type]
            box_style = getattr(box, t_styles.pop("box"), None)  # type: ignore[arg-type]

            options_table = Table(
                highlight=True,
                show_header=False,
                expand=True,
                box=box_style,
                **t_styles,  # type: ignore[arg-type]
            )
            # Strip the required column if none are required
            if all([x[0] == "" for x in options_rows]):
                options_rows = [x[1:] for x in options_rows]
            for row in options_rows:
                options_table.add_row(*row)
            console.print(
                Panel(
                    options_table,
                    border_style=config.style_options_panel_border,
                    title=option_group.get("name", config.options_panel_title),
                    title_align=config.align_options_panel,
                )
            )

    #
    # Groups only:
    # List click command groups
    #

    if isinstance(obj, MultiCommand):
        # Look through COMMAND_GROUPS for this command
        # stick anything unmatched into a default group at the end
        cmd_groups = config.command_groups.get(ctx.command_path, []).copy()
        cmd_groups.append({"commands": []})
        for command in obj.list_commands(ctx):
            for cmd_group in cmd_groups:
                if command in cmd_group.get("commands", []):
                    break
            else:
                commands: List[str] = cmd_groups[-1]["commands"]  # type: ignore[assignment]
                commands.append(command)

        # Print each command group panel
        for cmd_group in cmd_groups:
            t_styles = {
                "show_lines": config.style_commands_table_show_lines,
                "leading": config.style_commands_table_leading,
                "box": config.style_commands_table_box,
                "border_style": config.style_commands_table_border_style,
                "row_styles": config.style_commands_table_row_styles,
                "pad_edge": config.style_commands_table_pad_edge,
                "padding": config.style_commands_table_padding,
            }
            t_styles.update(cmd_group.get("table_styles", {}))  # type: ignore[arg-type]
            box_style = getattr(box, t_styles.pop("box"), None)  # type: ignore[arg-type]

            commands_table = Table(
                highlight=False,
                show_header=False,
                expand=True,
                box=box_style,
                **t_styles,  # type: ignore[arg-type]
            )
            # Define formatting in first column, as commands don't match highlighter regex
            # and set column ratio for first and second column, if a ratio has been set
            if config.style_commands_table_column_width_ratio is None:
                table_column_width_ratio: Union[Tuple[None, None], Tuple[int, int]] = (None, None)
            else:
                table_column_width_ratio = config.style_commands_table_column_width_ratio

            commands_table.add_column(style=config.style_command, no_wrap=True, ratio=table_column_width_ratio[0])
            commands_table.add_column(
                no_wrap=False,
                ratio=table_column_width_ratio[1],
            )
            for command in cmd_group.get("commands", []):
                # Skip if command does not exist
                if command not in obj.list_commands(ctx):
                    continue
                cmd = obj.get_command(ctx, command)
                if TYPE_CHECKING:
                    assert cmd is not None
                if cmd.hidden:
                    continue
                # Use the truncated short text as with vanilla text if requested
                if config.use_click_short_help:
                    helptext = cmd.get_short_help_str()
                else:
                    # Use short_help function argument if used, or the full help
                    helptext = cmd.short_help or cmd.help or ""
                commands_table.add_row(command, _make_command_help(helptext, formatter))
            if commands_table.row_count > 0:
                console.print(
                    Panel(
                        commands_table,
                        border_style=config.style_commands_panel_border,
                        title=cmd_group.get("name", config.commands_panel_title),
                        title_align=config.align_commands_panel,
                    )
                )

    # Epilogue if we have it
    if isinstance(obj, Command) and obj.epilog:
        # Remove single linebreaks, replace double with single
        lines = obj.epilog.split("\n\n")
        epilogue = "\n".join([x.replace("\n", " ").strip() for x in lines])
        console.print(Padding(Align(_make_rich_rext(epilogue, config.style_epilog_text, formatter), pad=False), 1))

    # Footer text if we have it
    if config.footer_text:
        console.print(Padding(_make_rich_rext(config.footer_text, config.style_footer_text, formatter), (1, 1, 0, 1)))


def rich_format_error(self: click.ClickException, formatter: Optional[RichHelpFormatter] = None) -> None:
    """Print richly formatted click errors.

    Called by custom exception handler to print richly formatted click errors.
    Mimics original click.ClickException.echo() function but with rich formatting.

    Args:
        click.ClickException: Click exception to format.
    """
    formatter = _get_rich_formatter(formatter)
    console = formatter.console
    config = formatter.config
    highlighter = formatter.config.highlighter
    # Print usage
    if getattr(self, "ctx", None) is not None:
        if TYPE_CHECKING:
            assert hasattr(self, "ctx")
        get_rich_usage(self.ctx.command, self.ctx, formatter)
    if config.errors_suggestion:
        console.print(
            Padding(
                config.errors_suggestion,
                (0, 1, 0, 1),
            ),
            style=config.style_errors_suggestion,
        )
    elif (
        config.errors_suggestion is None
        and getattr(self, "ctx", None) is not None
        and self.ctx.command.get_help_option(self.ctx) is not None  # type: ignore[attr-defined]
    ):
        cmd_path = self.ctx.command_path  # type: ignore[attr-defined]
        help_option = self.ctx.help_option_names[0]  # type: ignore[attr-defined]
        console.print(
            Padding(
                Columns(
                    (
                        Text("Try"),
                        Text(f"'{cmd_path} {help_option}'", style=config.style_errors_suggestion_command),
                        Text("for help"),
                    )
                ),
                (0, 1, 0, 1),
            ),
            style=config.style_errors_suggestion,
        )

    # A major Python library using click (dbt-core) has its own exception
    # logic that subclasses ClickException, but does not use the message
    # attribute. Checking for the 'message' attribute works to make the
    # rich-click CLI compatible.
    if hasattr(self, "message"):
        console.print(
            Padding(
                Panel(
                    highlighter(self.format_message()),
                    border_style=config.style_errors_panel_border,
                    title=config.errors_panel_title,
                    title_align=config.align_errors_panel,
                ),
                (0, 0, 1, 0),
            )
        )
    if config.errors_epilogue:
        console.print(Padding(config.errors_epilogue, (0, 1, 1, 1)))


def rich_abort_error(formatter: Optional[RichHelpFormatter] = None) -> None:
    """Print richly formatted abort error."""
    formatter = _get_rich_formatter(formatter)
    config = formatter.config
    formatter.console.print(config.aborted_text, style=config.style_aborted)


module_config: Optional[RichHelpConfiguration] = None


def get_module_help_configuration() -> RichHelpConfiguration:
    """Get Module-level help configuration resolved into a `RichHelpConfiguration` instance."""
    global module_config
    if module_config:
        return module_config
    module_config = RichHelpConfiguration(
        STYLE_OPTION,
        STYLE_ARGUMENT,
        STYLE_COMMAND,
        STYLE_SWITCH,
        STYLE_METAVAR,
        STYLE_METAVAR_APPEND,
        STYLE_METAVAR_SEPARATOR,
        STYLE_HEADER_TEXT,
        STYLE_EPILOG_TEXT,
        STYLE_FOOTER_TEXT,
        STYLE_USAGE,
        STYLE_USAGE_COMMAND,
        STYLE_DEPRECATED,
        STYLE_HELPTEXT_FIRST_LINE,
        STYLE_HELPTEXT,
        STYLE_OPTION_HELP,
        STYLE_OPTION_DEFAULT,
        STYLE_OPTION_ENVVAR,
        STYLE_REQUIRED_SHORT,
        STYLE_REQUIRED_LONG,
        STYLE_OPTIONS_PANEL_BORDER,
        ALIGN_OPTIONS_PANEL,
        STYLE_OPTIONS_TABLE_SHOW_LINES,
        STYLE_OPTIONS_TABLE_LEADING,
        STYLE_OPTIONS_TABLE_PAD_EDGE,
        STYLE_OPTIONS_TABLE_PADDING,
        STYLE_OPTIONS_TABLE_BOX,
        STYLE_OPTIONS_TABLE_ROW_STYLES,
        STYLE_OPTIONS_TABLE_BORDER_STYLE,
        STYLE_COMMANDS_PANEL_BORDER,
        ALIGN_COMMANDS_PANEL,
        STYLE_COMMANDS_TABLE_SHOW_LINES,
        STYLE_COMMANDS_TABLE_LEADING,
        STYLE_COMMANDS_TABLE_PAD_EDGE,
        STYLE_COMMANDS_TABLE_PADDING,
        STYLE_COMMANDS_TABLE_BOX,
        STYLE_COMMANDS_TABLE_ROW_STYLES,
        STYLE_COMMANDS_TABLE_BORDER_STYLE,
        STYLE_COMMANDS_TABLE_COLUMN_WIDTH_RATIO,
        STYLE_ERRORS_PANEL_BORDER,
        ALIGN_ERRORS_PANEL,
        STYLE_ERRORS_SUGGESTION,
        STYLE_ERRORS_SUGGESTION_COMMAND,
        STYLE_ABORTED,
        WIDTH,
        MAX_WIDTH,
        COLOR_SYSTEM,
        FORCE_TERMINAL,
        HEADER_TEXT,
        FOOTER_TEXT,
        DEPRECATED_STRING,
        DEFAULT_STRING,
        ENVVAR_STRING,
        REQUIRED_SHORT_STRING,
        REQUIRED_LONG_STRING,
        RANGE_STRING,
        APPEND_METAVARS_HELP_STRING,
        ARGUMENTS_PANEL_TITLE,
        OPTIONS_PANEL_TITLE,
        COMMANDS_PANEL_TITLE,
        ERRORS_PANEL_TITLE,
        ERRORS_SUGGESTION,
        ERRORS_EPILOGUE,
        ABORTED_TEXT,
        SHOW_ARGUMENTS,
        SHOW_METAVARS_COLUMN,
        APPEND_METAVARS_HELP,
        GROUP_ARGUMENTS_OPTIONS,
        OPTION_ENVVAR_FIRST,
        USE_MARKDOWN,
        USE_MARKDOWN_EMOJI,
        USE_RICH_MARKUP,
        COMMAND_GROUPS,
        OPTION_GROUPS,
        USE_CLICK_SHORT_HELP,
        highlighter,
    )
    return module_config
