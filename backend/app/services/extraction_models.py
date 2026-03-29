"""Pydantic models for extraction output validation and model registry."""

from __future__ import annotations

# ruff: noqa: UP045
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ExtractionAlternativeGroup(BaseModel):
    """Alternative group suggestion with confidence score."""

    model_config = ConfigDict(extra="forbid")

    group_id: Optional[str] = None
    group_name: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0)


class ExtractionRecurrence(BaseModel):
    """Recurrence configuration for a task."""

    model_config = ConfigDict(extra="forbid")

    # Keep recurrence validation at candidate-normalization time so a single
    # malformed recurrence does not fail the whole extraction payload.
    frequency: str
    weekday: Optional[int] = None
    day_of_month: Optional[int] = None


class ExtractionSubtask(BaseModel):
    """Subtask extracted from transcript."""

    model_config = ConfigDict(extra="forbid")

    title: str


class ExtractedTaskCandidate(BaseModel):
    """Single task candidate extracted from transcript."""

    model_config = ConfigDict(extra="forbid")

    title: str
    description: Optional[str] = None
    due_date: Optional[date] = None
    reminder_at: Optional[datetime] = None
    group_id: Optional[str] = None
    group_name: Optional[str] = None
    top_confidence: float = Field(default=0.9, ge=0.0, le=1.0)
    alternative_groups: list[ExtractionAlternativeGroup] = Field(default_factory=list)
    recurrence: Optional[ExtractionRecurrence] = None
    subtasks: list[ExtractionSubtask] = Field(default_factory=list)


class ExtractorPayload(BaseModel):
    """Complete extraction payload with list of task candidates."""

    model_config = ConfigDict(extra="forbid")

    tasks: list[ExtractedTaskCandidate]


# Model Registry for A/B Testing


class ExtractionModelConfig(BaseModel):
    """Configuration for a single extraction model."""

    name: str
    model_id: str
    weight: float = 1.0  # For weighted A/B testing
    temperature: float = 0.0
    max_tokens: Optional[int] = None
    is_default: bool = False


class ExtractionModelRegistry:
    """Registry for managing multiple extraction models with A/B testing."""

    def __init__(
        self,
        configs: list[ExtractionModelConfig],
        ab_test_enabled: bool = False,
    ) -> None:
        self.configs = configs
        self.ab_test_enabled = ab_test_enabled
        self.default_config = next(
            (c for c in configs if c.is_default),
            configs[0] if configs else None,
        )

    def select_model(self) -> ExtractionModelConfig:
        """Select a model based on A/B testing strategy.

        Returns:
            Selected model configuration.

        Raises:
            ValueError: If no models are configured.
        """
        if not self.configs:
            raise ValueError("No extraction models configured")

        # If A/B testing disabled, return default
        if not self.ab_test_enabled:
            return self.default_config

        # Weighted random selection for A/B testing
        import random

        total_weight = sum(c.weight for c in self.configs)
        rand_val = random.uniform(0, total_weight)
        cumulative = 0.0

        for config in self.configs:
            cumulative += config.weight
            if rand_val <= cumulative:
                return config

        return self.default_config

    def get_config_by_name(self, name: str) -> ExtractionModelConfig | None:
        """Get specific model config by name.

        Args:
            name: Model name to find.

        Returns:
            Model configuration if found, None otherwise.
        """
        return next((c for c in self.configs if c.name == name), None)

    @classmethod
    def from_yaml(cls, yaml_path: str, ab_test_enabled: bool = False) -> ExtractionModelRegistry:
        """Load model configurations from a YAML file.

        Args:
            yaml_path: Path to YAML configuration file.
            ab_test_enabled: Whether A/B testing is enabled.

        Returns:
            Configured model registry.
        """
        try:
            import yaml
        except ImportError:
            raise ImportError(
                "pyyaml is required for YAML model configuration. "
                "Install it with: pip install 'gust-backend[ab-testing]'"
            ) from None

        with open(yaml_path) as f:
            data = yaml.safe_load(f)

        configs = [ExtractionModelConfig(**model) for model in data.get("models", [])]
        return cls(configs=configs, ab_test_enabled=ab_test_enabled)

    @classmethod
    def default(cls, model_id: str, ab_test_enabled: bool = False) -> ExtractionModelRegistry:
        """Create a default registry with a single model.

        Args:
            model_id: Default model ID.
            ab_test_enabled: Whether A/B testing is enabled.

        Returns:
            Registry with single default model.
        """
        default_config = ExtractionModelConfig(
            name="default",
            model_id=model_id,
            weight=1.0,
            is_default=True,
        )
        return cls(configs=[default_config], ab_test_enabled=ab_test_enabled)
