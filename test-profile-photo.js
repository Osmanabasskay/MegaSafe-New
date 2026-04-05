// Simple test to verify ImagePicker functionality
import * as ImagePicker from 'expo-image-picker';

console.log('Testing ImagePicker...');

// Test if ImagePicker is available
if (ImagePicker) {
  console.log('ImagePicker is available');
} else {
  console.log('ImagePicker is NOT available');
}

// Test media types
console.log('MediaTypes:', ImagePicker.MediaTypeOptions);
