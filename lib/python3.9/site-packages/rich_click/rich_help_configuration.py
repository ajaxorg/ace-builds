import os
from dataclasses import dataclass, field
from os import getenv
from typing import Any, Dict, List, Optional, Tuple, Union

import rich.align
import rich.highlighter
import rich.padding
import rich.style
import rich.table
from typing_extensions import Literal

from rich_click.utils import truthy


def force_terminal_default() -> Optional[bool]:
    """Use as the default factory for `force_terminal`."""
    env_vars = {"GITHUB_ACTIONS", "FORCE_COLOR", "PY_COLORS"}
    if all(i not in os.environ for i in env_vars):
        return None
    else:
        return any(truthy(getenv(i)) for i in env_vars)


def terminal_width_default() -> Optional[int]:
    """Use as the default factory for `width` and `max_width`."""
    width = getenv("TERMINAL_WIDTH")
    if width:
        try:
            return int(width)
        except ValueError:
            import warnings

            warnings.warn("Environment variable `TERMINAL_WIDTH` cannot be cast to an integer.", UserWarning)
            return None
    return None


class OptionHighlighter(rich.highlighter.RegexHighlighter):
    """Highlights our special options."""

    highlights = [
        r"(^|\W)(?P<switch>\-\w+)(?![a-zA-Z0-9])",
        r"(^|\W)(?P<option>\-\-[\w\-]+)(?![a-zA-Z0-9])",
        r"(?P<metavar>\<[^\>]+\>)",
    ]


@dataclass
class RichHelpConfiguration:
    """Rich Help Configuration Class."""

    # Default styles
    style_option: rich.style.StyleType = field(default="bold cyan")
    style_argument: rich.style.StyleType = field(default="bold cyan")
    style_command: rich.style.StyleType = field(default="bold cyan")
    style_switch: rich.style.StyleType = field(default="bold green")
    style_metavar: rich.style.StyleType = field(default="bold yellow")
    style_metavar_append: rich.style.StyleType = field(default="dim yellow")
    style_metavar_separator: rich.style.StyleType = field(default="dim")
    style_header_text: rich.style.StyleType = field(default="")
    style_epilog_text: rich.style.StyleType = field(default="")
    style_footer_text: rich.style.StyleType = field(default="")
    style_usage: rich.style.StyleType = field(default="yellow")
    style_usage_command: rich.style.StyleType = field(default="bold")
    style_deprecated: rich.style.StyleType = field(default="red")
    style_helptext_first_line: rich.style.StyleType = field(default="")
    style_helptext: rich.style.StyleType = field(default="dim")
    style_option_help: rich.style.StyleType = field(default="")
    style_option_default: rich.style.StyleType = field(default="dim")
    style_option_envvar: rich.style.StyleType = field(default="dim yellow")
    style_required_short: rich.style.StyleType = field(default="red")
    style_required_long: rich.style.StyleType = field(default="dim red")
    style_options_panel_border: rich.style.StyleType = field(default="dim")
    align_options_panel: rich.align.AlignMethod = field(default="left")
    style_options_table_show_lines: bool = field(default=False)
    style_options_table_leading: int = field(default=0)
    style_options_table_pad_edge: bool = field(default=False)
    style_options_table_padding: rich.padding.PaddingDimensions = field(default_factory=lambda: (0, 1))
    style_options_table_box: rich.style.StyleType = field(default="")
    style_options_table_row_styles: Optional[List[rich.style.StyleType]] = field(default=None)
    style_options_table_border_style: Optional[rich.style.StyleType] = field(default=None)
    style_commands_panel_border: rich.style.StyleType = field(default="dim")
    align_commands_panel: rich.align.AlignMethod = field(default="left")
    style_commands_table_show_lines: bool = field(default=False)
    style_commands_table_leading: int = field(default=0)
    style_commands_table_pad_edge: bool = field(default=False)
    style_commands_table_padding: rich.padding.PaddingDimensions = field(default_factory=lambda: (0, 1))
    style_commands_table_box: rich.style.StyleType = field(default="")
    style_commands_table_row_styles: Optional[List[rich.style.StyleType]] = field(default=None)
    style_commands_table_border_style: Optional[rich.style.StyleType] = field(default=None)
    style_commands_table_column_width_ratio: Optional[Union[Tuple[None, None], Tuple[int, int]]] = field(
        default_factory=lambda: (None, None)
    )
    style_errors_panel_border: rich.style.StyleType = field(default="red")
    align_errors_panel: rich.align.AlignMethod = field(default="left")
    style_errors_suggestion: rich.style.StyleType = field(default="dim")
    style_errors_suggestion_command: rich.style.StyleType = field(default="blue")
    style_aborted: rich.style.StyleType = field(default="red")
    width: Optional[int] = field(default_factory=terminal_width_default)
    max_width: Optional[int] = field(default_factory=terminal_width_default)
    color_system: Optional[Literal["auto", "standard", "256", "truecolor", "windows"]] = field(default="auto")
    force_terminal: Optional[bool] = field(default_factory=force_terminal_default)

    # Fixed strings
    header_text: Optional[str] = field(default=None)
    footer_text: Optional[str] = field(default=None)
    deprecated_string: str = field(default="(Deprecated) ")
    default_string: str = field(default="[default: {}]")
    envvar_string: str = field(default="[env var: {}]")
    required_short_string: str = field(default="*")
    required_long_string: str = field(default="[required]")
    range_string: str = field(default=" [{}]")
    append_metavars_help_string: str = field(default="({})")
    arguments_panel_title: str = field(default="Arguments")
    options_panel_title: str = field(default="Options")
    commands_panel_title: str = field(default="Commands")
    errors_panel_title: str = field(default="Error")
    errors_suggestion: Optional[str] = field(default=None)
    """Defaults to Try 'cmd -h' for help. Set to False to disable."""
    errors_epilogue: Optional[str] = field(default=None)
    aborted_text: str = field(default="Aborted.")

    # Behaviours
    show_arguments: bool = field(default=False)
    """Show positional arguments"""
    show_metavars_column: bool = field(default=True)
    """Show a column with the option metavar (eg. INTEGER)"""
    append_metavars_help: bool = field(default=False)
    """Append metavar (eg. [TEXT]) after the help text"""
    group_arguments_options: bool = field(default=False)
    """Show arguments with options instead of in own panel"""
    option_envvar_first: bool = field(default=False)
    """Show env vars before option help text instead of after"""
    use_markdown: bool = field(default=False)
    use_markdown_emoji: bool = field(default=True)
    """Parse emoji codes in markdown :smile:"""
    use_rich_markup: bool = field(default=False)
    """Parse help strings for rich markup (eg. [red]my text[/])"""
    command_groups: Dict[str, List[Dict[str, Union[str, Any]]]] = field(default_factory=lambda: {})
    """Define sorted groups of panels to display subcommands"""
    option_groups: Dict[str, List[Dict[str, Union[str, Any]]]] = field(default_factory=lambda: {})
    """Define sorted groups of panels to display options and arguments"""
    use_click_short_help: bool = field(default=False)
    """Use click's default function to truncate help text"""
    highlighter: rich.highlighter.Highlighter = field(default_factory=lambda: OptionHighlighter())
    """Rich regex highlighter for help highlighting"""
    legacy_windows: Optional[bool] = field(default=False)
