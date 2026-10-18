terraform {
  required_version = ">= 1.7.0"
  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 8.7"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}
