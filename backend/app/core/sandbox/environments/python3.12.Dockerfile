FROM python:3.12-slim

# Set working directory
WORKDIR /workspace

# Install common utilities and Node.js (for ast-grep)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    vim \
    nano \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install ast-grep for AST-aware code search
RUN npm install -g @ast-grep/cli

# Install common Python packages
RUN pip install --no-cache-dir \
    requests \
    numpy \
    pandas \
    matplotlib \
    scikit-learn \
    pytest \
    ipython

# Create workspace structure
RUN mkdir -p /workspace/project_files \
    /workspace/out

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV WORKSPACE=/workspace

# Default command
CMD ["/bin/bash"]
