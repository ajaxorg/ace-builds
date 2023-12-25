from typing import Any, Optional, Type

import click
from rich.console import Console

from rich_click.rich_help_configuration import RichHelpConfiguration
from rich_click.rich_help_formatter import RichHelpFormatter


class RichContext(click.Context):
    """Click Context class endowed with Rich superpowers."""

    formatter_class: Type[RichHelpFormatter] = RichHelpFormatter

    def __init__(
        self,
        *args: Any,
        rich_console: Optional[Console] = None,
        rich_help_config: Optional[RichHelpConfiguration] = None,
        **kwargs: Any,
    ) -> None:
        """Create Rich Context instance.

        Args:
            rich_console: Rich Console.
                Defaults to None.
            rich_help_config: Rich help configuration.
                Defaults to None.
        """
        super().__init__(*args, **kwargs)
        parent: Optional[RichContext] = kwargs.pop("parent", None)

        if rich_console is None and hasattr(parent, "console"):
            rich_console = parent.console  # type: ignore[has-type,union-attr]

        self.console = rich_console

        if rich_help_config is None and hasattr(parent, "help_config"):
            rich_help_config = parent.help_config  # type: ignore[has-type,union-attr]

        self.help_config = rich_help_config

    def make_formatter(self) -> RichHelpFormatter:
        """Create the Rich Help Formatter."""
        return self.formatter_class(
            width=self.terminal_width, max_width=self.max_content_width, config=self.help_config
        )
