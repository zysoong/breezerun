"""LLM provider abstraction using LiteLLM."""

import os
from typing import List, Dict, Any, AsyncIterator, Optional
from litellm import acompletion
import litellm

# Disable LiteLLM logging by default
litellm.suppress_debug_info = True


class LLMProvider:
    """LLM provider using LiteLLM for unified API access."""

    def __init__(
        self,
        provider: str = "openai",
        model: str = "gpt-4",
        api_key: Optional[str] = None,
        **config
    ):
        """
        Initialize LLM provider.

        Args:
            provider: Provider name (openai, anthropic, azure, etc.)
            model: Model name
            api_key: API key for the provider
            **config: Additional configuration (temperature, max_tokens, etc.)
        """
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.config = config

        # Set API key in environment if provided
        if api_key:
            self._set_api_key(provider, api_key)

    def _set_api_key(self, provider: str, api_key: str):
        """Set API key in environment based on provider."""
        key_mapping = {
            "openai": "OPENAI_API_KEY",
            "anthropic": "ANTHROPIC_API_KEY",
            "azure": "AZURE_API_KEY",
            "cohere": "COHERE_API_KEY",
            "huggingface": "HUGGINGFACE_API_KEY",
        }

        env_key = key_mapping.get(provider.lower())
        if env_key:
            os.environ[env_key] = api_key

    def _build_model_name(self) -> str:
        """Build the full model name for LiteLLM."""
        # For most providers, LiteLLM uses format: provider/model
        # For OpenAI, just the model name is fine
        if self.provider.lower() == "openai":
            return self.model
        return f"{self.provider}/{self.model}"

    async def generate(
        self,
        messages: List[Dict[str, str]],
        stream: bool = False,
        **kwargs
    ) -> Any:
        """
        Generate completion from LLM.

        Args:
            messages: List of message dicts with 'role' and 'content'
            stream: Whether to stream the response
            **kwargs: Additional parameters for the completion

        Returns:
            Completion response or async iterator if streaming
        """
        # Merge config with kwargs
        params = {**self.config, **kwargs}

        model_name = self._build_model_name()

        try:
            response = await acompletion(
                model=model_name,
                messages=messages,
                stream=stream,
                **params
            )

            return response

        except Exception as e:
            raise Exception(f"LLM generation failed: {str(e)}")

    async def generate_stream(
        self,
        messages: List[Dict[str, str]],
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> AsyncIterator[str | Dict[str, Any]]:
        """
        Generate streaming completion from LLM.

        Args:
            messages: List of message dicts with 'role' and 'content'
            tools: Optional list of tools for function calling
            **kwargs: Additional parameters for the completion

        Yields:
            Text chunks as they arrive, or function call dicts
        """
        params = {**self.config, **kwargs}
        model_name = self._build_model_name()

        # Add tools to params if provided
        if tools:
            params['tools'] = tools
            params['tool_choice'] = 'auto'

        try:
            response = await acompletion(
                model=model_name,
                messages=messages,
                stream=True,
                **params
            )

            async for chunk in response:
                # Extract content from the chunk
                if hasattr(chunk, 'choices') and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta

                    # Handle text content
                    if hasattr(delta, 'content') and delta.content:
                        yield delta.content

                    # Handle function calls
                    if hasattr(delta, 'tool_calls') and delta.tool_calls:
                        for tool_call in delta.tool_calls:
                            if hasattr(tool_call, 'function'):
                                yield {
                                    "function_call": {
                                        "name": tool_call.function.name,
                                        "arguments": tool_call.function.arguments,
                                    }
                                }

        except Exception as e:
            raise Exception(f"LLM streaming failed: {str(e)}")


def create_llm_provider(
    provider: str,
    model: str,
    llm_config: Dict[str, Any],
    api_key: Optional[str] = None
) -> LLMProvider:
    """
    Factory function to create LLM provider.

    Args:
        provider: Provider name
        model: Model name
        llm_config: LLM configuration dict
        api_key: Optional API key

    Returns:
        LLMProvider instance
    """
    return LLMProvider(
        provider=provider,
        model=model,
        api_key=api_key,
        **llm_config
    )
